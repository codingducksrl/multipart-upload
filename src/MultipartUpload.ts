import type {CompleteUploadAction, HashAlgorithm, StartUploadAction, UploadedPart} from "./types.ts";
import {hashParts} from "./hash.ts";
import axios, {type AxiosInstance} from "axios";
import axiosRetry, {type IAxiosRetryConfig} from 'axios-retry';


type Options = {
    algorithm: HashAlgorithm,
    maxFilePartSize: number,
    retryOptions: IAxiosRetryConfig
}

export class MultipartUpload<METADATA = never> {

    protected progressListener: ((id: string, progress: number) => void) | null = null;
    protected awsChecksumAlgorithm: string;

    protected algorithm: HashAlgorithm = "SHA-256";
    protected maxFilePartSize: number = 100 * 1024 * 1024; // 100 MB

    protected axiosInstance: AxiosInstance;

    /**
     * Creates an instance of MultipartUpload.
     * @param startUploadAction - Function to initiate the upload process, creates the parts and the presigned URLs.
     * @param completeUploadAction - Function to finalize the upload process, completes the multipart upload on the server.
     * @param options - Optional configuration options such as algorithm and maxFilePartSize.
     * */
    constructor(
        protected startUploadAction: StartUploadAction<METADATA>,
        protected completeUploadAction: CompleteUploadAction<METADATA>,
        options: Partial<Options> = {},
    ) {
        if (options.algorithm) {
            this.algorithm = options.algorithm;
        }
        if (options.maxFilePartSize) {
            this.maxFilePartSize = options.maxFilePartSize;
        }
        this.awsChecksumAlgorithm = this.computeAwsChecksumAlgorithm()

        let retryConfig: IAxiosRetryConfig = {retries: 3, retryDelay: axiosRetry.exponentialDelay};
        if (options.retryOptions) {
            retryConfig = options.retryOptions;
        }

        this.axiosInstance = axios.create()
        axiosRetry(this.axiosInstance, retryConfig);
    }

    /**
     * Uploads a file in multiple parts.
     * @param id - Unique identifier for the upload session.
     * @param file - The file to be uploaded.
     * @param metadata - Additional metadata that will be sent in both start and complete upload actions.
     * */
    public async upload(id: string, file: File, metadata: METADATA) {

        this.notifyProgress(id, 1);
        const startResponse = await this.startUploadAction(id, this.maxFilePartSize, file.size, metadata);
        this.notifyProgress(id, 2);
        const hashResponse = await hashParts(this.algorithm, {id, parts: startResponse.parts, file});
        let progress = this.notifyProgress(id, 10);

        const promises: Promise<UploadedPart>[] = [];

        const partProgress: { [partNumber: number]: number } = {};

        const progressIncrement = 85 / startResponse.parts.length;
        for (let i = 0; i < startResponse.parts.length; i++) {
            const part = startResponse.parts[i];
            const hashPart = hashResponse.parts[i];
            const filePart = file.slice(part.start, part.end);

            const request = this.axiosInstance.put(part.url, filePart, {
                headers: {
                    'Content-Type': file.type,
                    "x-amz-sdk-checksum-algorithm": this.awsChecksumAlgorithm,
                    "x-amz-checksum-sha256": hashPart.hash
                },
                onUploadProgress: (progressEvent) => {
                    partProgress[part.part_number] = (progressEvent.loaded / (progressEvent.total ?? filePart.size)) * progressIncrement;
                    this.notifyProgress(id, progress, partProgress);
                },
            }).then((response) => {
                partProgress[part.part_number] = progressIncrement;
                progress = this.notifyProgress(id, progress, partProgress);
                return {
                    partNumber: part.part_number,
                    hash: hashPart.hash,
                    size: part.end - part.start,
                    etag: (response.headers.etag as string).replace(/"/g, '')
                }
            })
            promises.push(request)
        }
        const uploadedParts = await Promise.all(promises);
        await this.completeUploadAction(id, startResponse.upload_id, uploadedParts, metadata);
        this.notifyProgress(id, 100)
    }

    public setProgressListener(listener: (id: string, progress: number) => void) {
        this.progressListener = listener;
    }

    protected notifyProgress(id: string, progress: number, partProgress?: { [partNumber: number]: number }): number {
        let finalProgress = progress;
        if (partProgress) {
            finalProgress = Object.values(partProgress).reduce((a, b) => a + b, 0) + progress;
        }

        if (this.progressListener) {
            this.progressListener(id, finalProgress);
        }
        return progress;
    }

    private computeAwsChecksumAlgorithm() {
        switch (this.algorithm) {
            case "SHA-256":
                return "SHA256";
            default:
                throw new Error(`Unsupported algorithm: ${this.algorithm}`);
        }
    }
}
