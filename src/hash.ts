import type {HashAlgorithm, MultipartFile} from "./types.ts";

type HashedPart = {
    partNumber: number;
    hash: string;
}

type HashResponse = {
    id: string;
    parts: HashedPart[];
    hash: string;
}

function hashToBase64(hash: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

/**
 * Hashes the parts of a multipart file using the specified algorithm. It creates one hash per part and a composite hash of all parts.
 * All hashes are returned in base64 format as required by S3.
 * @param algorithm - The hashing algorithm to use (e.g., "SHA-256").
 * @param file - The multipart file containing parts to be hashed.
 * @returns A promise that resolves to a HashResponse containing the file ID, an array of hashed parts, and the composite hash.
 * */
export async function hashParts(algorithm: HashAlgorithm, file: MultipartFile): Promise<HashResponse> {
    const parts = file.parts.sort((a, b) => a.part_number - b.part_number);
    const hashedParts: HashedPart[] = [];
    let fullHash: Blob = new Blob([])

    for (let partNumber = 0; partNumber < parts?.length; partNumber++) {

        const partResponse = parts[partNumber];

        const start = partResponse.start;
        const end = partResponse.end;
        const filePart = file.file.slice(start, end);
        const data = await filePart.arrayBuffer();
        const hash = await crypto.subtle.digest(algorithm, data);
        hashedParts.push({
            partNumber: partResponse.part_number,
            hash: hashToBase64(hash)
        })
        fullHash = new Blob([fullHash, hash]);
    }

    const compositeHash = await crypto.subtle.digest("SHA-256", await fullHash.arrayBuffer())

    return {
        id: file.id,
        parts: hashedParts,
        hash: hashToBase64(compositeHash)
    };
}
