/**
 * Nguồn ảo (`nguon://cargo`, `nguon://scip`…) không phải tệp trên đĩa: mở bằng editor sẽ ra
 * tab chết ("Tệp không còn tồn tại"). Mọi surface đi qua `openCode` chung đều phải coi đây là
 * node trên đồ thị, không phải đường dẫn mở được.
 */
export const isVirtualSource = (file: string | null | undefined): boolean => !!file && file.includes('://')
