/**
 * File Context Provider
 * Thin wrapper around ContextProviderImpl + FileStorage.
 */

import { ContextProviderImpl } from './provider.js'
import { FileStorage } from './storage.js'

/**
 * File-based ContextProvider.
 * All domain logic is in ContextProviderImpl;
 * FileStorage handles I/O.
 */
export class FileContextProvider extends ContextProviderImpl {
  constructor(storage: FileStorage, validAgents: string[]) {
    super(storage, validAgents)
  }
}

/**
 * Create a FileContextProvider with default paths.
 *
 * Directory layout:
 *   contextDir/
 *   ├── channel.jsonl        # Channel log (JSONL)
 *   ├── documents/           # Team documents
 *   │   └── notes.md         # Default document
 *   ├── resources/           # Resource blobs
 *   ├── _state/
 *   │   ├── inbox.json       # Inbox read cursors
 *   │   └── proposals.json   # Proposal state
 *   └── ...
 */
export function createFileContextProvider(
  contextDir: string,
  validAgents: string[]
): FileContextProvider {
  const storage = new FileStorage(contextDir)
  return new FileContextProvider(storage, validAgents)
}
