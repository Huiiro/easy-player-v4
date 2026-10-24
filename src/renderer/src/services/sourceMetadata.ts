import {
  SOURCE_METADATA_FIELDS,
  type SourceMetadataPatch,
  type SourceMetadataSnapshot,
  type SourceTrackDetail,
  type SourceMetadataField
} from '../../../shared/sourceMetadata'
export type SourceDiffField = SourceMetadataField | 'lyrics' | 'coverDataUrl'
export interface SourceMetadataDiff {
  field: SourceDiffField
  current: string | number | undefined
  incoming: string | number
}
export function sourceMetadataDiff(
  snapshot: SourceMetadataSnapshot | undefined,
  detail: SourceTrackDetail | undefined,
  assets: { lyrics?: string; coverDataUrl?: string }
): SourceMetadataDiff[] {
  if (!snapshot || !detail) return []
  const incoming = { ...detail.metadata, ...assets }
  const fields: readonly SourceDiffField[] = [...SOURCE_METADATA_FIELDS, 'lyrics', 'coverDataUrl']
  return fields.flatMap((field) => {
    const value = incoming[field]
    if (value === undefined || value === '' || value === snapshot.metadata[field]) return []
    return [
      {
        field,
        current: snapshot.metadata[field],
        incoming: value
      }
    ]
  })
}
export function selectedSourcePatch(
  rows: SourceMetadataDiff[],
  selected: SourceDiffField[]
): SourceMetadataPatch {
  return Object.fromEntries(
    rows.filter((row) => selected.includes(row.field)).map((row) => [row.field, row.incoming])
  )
}
