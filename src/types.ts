export type MultipartFile = {
    id: string
    parts: {
        part_number: number;
        start: number;
        end: number
    }[]
    file: Blob
}

export type HashAlgorithm = "SHA-256";

/**
 * Response returned by the Start Upload action
 * * upload_id - The Upload ID returned by S3
 * * file_id - The id given to the Start upload action
 * * parts - An array of parts with their part number, upload URL, start and end byte positions
 * */
type StartUploadResponse = {
    upload_id: string, // The Upload ID returned by S3
    parts: {
        part_number: number,
        url: string,
        start: number,
        end: number
    }[]
}


export type StartUploadAction<T> = (id: string, maxPartSize: number, fileSize: number, metadata: T) => Promise<StartUploadResponse>
export type CompleteUploadAction<T> = (id: string, uploadId: string, parts: UploadedPart[], metadata: T) => Promise<void>

export type UploadedPart = {
    partNumber: number,
    hash: string,
    size: number,
    etag: string
}
