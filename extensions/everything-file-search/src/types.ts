export interface FileRecord {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  acronym?: string;
  pinyin?: string;
}

export type SortOption =
  | "name-asc"
  | "name-desc"
  | "size-desc"
  | "size-asc"
  | "mtime-desc"
  | "mtime-asc";

export type TypeFilter =
  | "all"
  | "folder"
  | "document"
  | "image"
  | "media"
  | "code"
  | "archive"
  | "app";
