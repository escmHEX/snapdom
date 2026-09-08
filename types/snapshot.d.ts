export interface SnapshotOptions {
  exclude?: string[];
  /** URLs of versioned stylesheets whose CSSOM the caller never mutates. */
  immutableStyleSheets?: string[];
}
export interface SnapshotViewport {
  readonly width: number;
  readonly height: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly colorScheme: 'light' | 'dark';
}
export interface DOMSnapshot {
  readonly element: Element;
  readonly viewport: SnapshotViewport;
  /** Original/copy nodes, or transport IDs on a deserialized snapshot. */
  nodeFor(original: Node | number): Node | undefined;
  dispose(): void;
}
export interface MaterializedSnapshot {
  readonly element: Element;
  nodeFor(copiedNode: Node | number): Node | undefined;
  dispose(): void;
}
/** Opaque node/state records. Pass the entire payload through structured clone. */
export interface SerializedSnapshot {
  readonly version: 1;
  readonly viewport: SnapshotViewport;
  readonly [key: string]: unknown;
}
export interface SnapshotTransfer {
  readonly payload: SerializedSnapshot;
  readonly transferables: ImageBitmap[];
  nodeId(originalOrCopy: Node): number | undefined;
  /** Closes unsent bitmaps and releases the source lookup; safe after transfer. */
  dispose(): void;
}
export interface SnapshotProcessingOptions {
  signal?: AbortSignal;
  budgetMs?: number;
  /** Idle spare-time work by default; background tasks for isolated processing. */
  schedulerMode?: 'idle' | 'background';
  fast?: boolean;
}
export function snapshot(element: Element, options?: SnapshotOptions): DOMSnapshot;
export function isSnapshot(value: unknown): value is DOMSnapshot;
/** Keep the source snapshot alive through serialization and resolving node IDs.
 * Concurrent disposal rejects serialization. The resulting payload is independent.
 */
export function serializeSnapshot(value: DOMSnapshot, options?: SnapshotProcessingOptions): Promise<SnapshotTransfer>;
/** Consumes transferred ImageBitmaps, including on abort/failure. */
export function deserializeSnapshot(value: SerializedSnapshot, options?: SnapshotProcessingOptions & {
  document?: Document;
}): Promise<DOMSnapshot>;
export function materializeSnapshot(value: DOMSnapshot, options?: {
  signal?: AbortSignal;
  budgetMs?: number;
  /** Idle spare-time work by default; background tasks for isolated processing. */
  schedulerMode?: 'idle' | 'background';
  resourceTimeoutMs?: number;
  /** Exclusive connected document with the captured viewport, color scheme and
   * compatibility mode. Its original HTML tree is restored on disposal. Scripts
   * and event attributes in captured nodes are disabled before connection.
   */
  document?: Document;
}): Promise<MaterializedSnapshot>;
