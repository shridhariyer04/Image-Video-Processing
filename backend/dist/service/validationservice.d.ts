export interface FileValidationOptions {
    maxSize?: number;
    minSize?: number;
    allowedMimeTypes?: string[];
    allowedExtensions?: string[];
    validateHeader?: boolean;
    validateContent?: boolean;
}
export interface FileInfo {
    path: string;
    originalName: string;
    size: number;
    mimeType: string;
}
export declare class FileValidationService {
    private static readonly DEFAULT_OPTIONS;
    private static readonly DANGEROUS_EXTENSIONS;
    private static readonly VIRUS_SIGNATURES;
    private static readonly MAX_FILENAME_LENGTH;
    /**
     * Comprehensive file validation
     */
    static validateFile(fileInfo: FileInfo, options?: FileValidationOptions): Promise<void>;
    /**
     * Validate basic file information
     */
    private static validateBasicFileInfo;
    /**
     * Validate file system properties
     */
    private static validateFileSystem;
    private static isConversionSUpported;
    /**
     * Validate file content and headers
     */
    private static validateFileContent;
    /**
     * Validate MIME type and extension match
     */
    private static validateMimeTypeExtensionMatch;
    /**
     * Validate file header matches MIME type
     */
    private static validateFileHeader;
    /**
     * Sanitize filename
     */
    static sanitizeFilename(filename: string): string;
    /**
     * Check if MIME type is supported
     */
    static isSupportedMimeType(mimeType: string): boolean;
}
