// Màu cụm và cỡ nút/cạnh của thẻ Bản đồ. Màu cụm chỉ để phân biệt, không mang ý nghĩa như màu ngữ nghĩa.
export const PALETTE = ['#1f5fbf', '#0f7c78', '#6a4fb3', '#b3407a', '#8a6d1f', '#2e7d4f', '#b86e00', '#3d6a8a', '#7a4b2a', '#5b6b7d']

export const communityColor = (c: number | null): string => (c == null ? '#9aa5b1' : PALETTE[c % PALETTE.length])

export const nodeSize = (files: number): number => Math.min(28, Math.max(4, 4 + 2 * Math.sqrt(files)))

export const edgeSize = (weight: number): number => Math.min(6, 0.5 + Math.log2(1 + weight) / 2)
