/**
 * Data layer barrel — what the server/API layer is allowed to reach for.
 *
 * Generation (importers, precompute, extraction) is deliberately NOT exported:
 * it is driven through the CLI (`src/cli.ts`) and the scripts/ launchers. The
 * API consumes the dataset; it never builds it.
 */

export { loadConfig } from './config';
export { streamBins } from './data';
export { openDataset, readManifest } from './parquet/dataset';
export { bandOptions, bandParamsFrom } from './bands/options';
export { listSymbols, listTables, loadBars, loadBins, maxTimestamp, minTimestamp, tableGlob } from './dataset/read';
