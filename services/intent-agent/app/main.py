from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .compiler import IntentCompiler, InvalidCompilerOutputError
from .models import CompileRequest, CompileResponse
from .providers import ProposalProvider, provider_from_env


def create_app(provider: ProposalProvider | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.compiler = IntentCompiler(provider or provider_from_env())
        yield

    app = FastAPI(
        title="BotBond Intent Compiler",
        version="0.1.0",
        lifespan=lifespan,
    )

    @app.exception_handler(InvalidCompilerOutputError)
    async def invalid_compiler_output(
        request: Request,
        exc: InvalidCompilerOutputError,
    ) -> JSONResponse:
        del request
        return JSONResponse(
            status_code=422,
            content={
                "error": "INVALID_COMPILER_OUTPUT",
                "message": str(exc),
                "attempts": exc.attempts,
                "validationErrors": exc.errors,
            },
        )

    @app.get("/healthz")
    async def health(request: Request) -> dict[str, object]:
        compiler: IntentCompiler = request.app.state.compiler
        fake = compiler.provider.mode == "FAKE"
        return {
            "status": "ok",
            "compilerMode": compiler.provider.mode,
            "fake": fake,
            "warning": (
                "FAKE INTENT COMPILER: deterministic local/CI output, not Gemini"
                if fake
                else None
            ),
        }

    @app.post("/v1/compile", response_model=CompileResponse)
    async def compile_intent(
        payload: CompileRequest,
        request: Request,
    ) -> CompileResponse:
        compiler: IntentCompiler = request.app.state.compiler
        return await compiler.compile(payload)

    return app


app = create_app()
