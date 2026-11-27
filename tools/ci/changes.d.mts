export type CiNeeds = { engine: 'full' | 'docs' | 'skip'; desktop: boolean; package: boolean; labs: boolean }
export const ALL: Readonly<CiNeeds>
export function classify(files: string[] | null | undefined): CiNeeds
