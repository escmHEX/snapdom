import type { SnapdomOptions, CaptureMeta, CanvasCrop } from './snapdom';

export interface RasterizeOptions extends Pick<SnapdomOptions,
  'width' | 'height' | 'scale' | 'dpr' | 'fast' | 'budgetMs' | 'signal' | 'schedulerMode'> {
  backgroundColor?: string | null;
  meta?: Readonly<CaptureMeta>;
  crop?: CanvasCrop;
  /** Ask the browser to optimize the export canvas for pixel readback. */
  willReadFrequently?: boolean;
}

/** Uses the existing canvas exporter in the calling document, without DOM capture. */
export function rasterize(url: string, options?: RasterizeOptions): Promise<HTMLCanvasElement>;
