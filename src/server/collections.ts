import { randomUUID } from "node:crypto";
import type { WatchedCollectionCatalog, WatchedCollectionView } from "../shared/contracts.js";
import type { LocalDatabase } from "./storage/database.js";

export class CollectionService {
  public constructor(private readonly database: LocalDatabase) {}

  public list(): WatchedCollectionCatalog {
    return { collections: this.database.listCollections() };
  }

  public create(input: { readonly name: string; readonly description?: string }): WatchedCollectionView {
    const name = boundedText(input.name, "Collection name", 80, false);
    const description = boundedText(input.description ?? "", "Collection description", 500, true);
    return this.database.createCollection(randomUUID(), name, description);
  }

  public replaceSpaces(
    collectionId: string,
    input: { readonly spaceIds: readonly string[] },
  ): WatchedCollectionView {
    if (!Array.isArray(input.spaceIds) || input.spaceIds.length > 10_000) {
      throw new Error("Collection space selection is invalid");
    }
    const spaceIds = input.spaceIds.map((value) => boundedText(value, "Space ID", 512, false));
    this.database.replaceCollectionSpaces(collectionId, spaceIds);
    const collection = this.database.listCollections().find((item) => item.id === collectionId);
    if (collection === undefined) throw new Error("Watched Collection was not found");
    return collection;
  }
}

function boundedText(value: unknown, label: string, maximum: number, allowEmpty: boolean): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const normalized = value.trim();
  if ((!allowEmpty && normalized === "") || normalized.length > maximum || /[\u0000]/u.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}
