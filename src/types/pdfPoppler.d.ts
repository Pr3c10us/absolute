declare module 'pdf-poppler' {
    export interface Options {
        format?: 'jpeg' | 'png' | 'tiff';
        out_dir?: string;
        out_prefix?: string;
        page?: number | null;
        scale?: number;
        resolution?: number;
    }

    export function convert(file: string, opts?: Options): Promise<void>;
    export function info(file: string): Promise<{
        pages: number;
        title?: string;
        author?: string;
        creator?: string;
        producer?: string;
    }>;
}
