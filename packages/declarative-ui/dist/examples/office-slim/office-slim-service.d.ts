import type { OfficeDocSummary, SlimOptions, SlimQualityPreset, VirtualOoxmlArchive } from './types.js';
export declare function formatOfficeBytes(bytes: number): string;
export declare function cleanCoreXmlMetadata(coreXml: string): string;
export declare function stripCommentsFromRelsXml(relsXml: string): string;
export declare function packOoxmlArchiveToBytes(archive: VirtualOoxmlArchive): Uint8Array;
export declare function unpackOoxmlArchiveFromBytes(rawBytes: Uint8Array, fallbackFileName?: string): VirtualOoxmlArchive;
export declare function inspectOoxmlArchive(rawBytes: Uint8Array, filePath?: string, quality?: SlimQualityPreset): OfficeDocSummary;
export declare function processOoxmlSlimArchive(rawBytes: Uint8Array, options: SlimOptions): {
    outputBytes: Uint8Array;
    outputArchive: VirtualOoxmlArchive;
    finalMediaTotalBytes: number;
    savedPercent: number;
};
export declare function extractImagesFromOoxmlArchive(rawBytes: Uint8Array): Array<{
    entryPath: string;
    name: string;
    bytes: Uint8Array;
}>;
