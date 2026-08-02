import { Firestore } from "@google-cloud/firestore";
import { InMemoryRepository, type Repository } from "./repository.js";
import { FirestoreRepository } from "./firestore-repository.js";

export function repositoryFromEnvironment(): Repository {
  const mode = process.env.REPOSITORY_MODE ?? "memory";
  if (mode === "memory") return new InMemoryRepository();
  if (mode !== "firestore") throw new Error("REPOSITORY_MODE must be 'memory' or 'firestore'");
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("GOOGLE_CLOUD_PROJECT_REQUIRED_FOR_FIRESTORE");
  return new FirestoreRepository(new Firestore({ projectId }), process.env.FIRESTORE_NAMESPACE ?? "botbond");
}
