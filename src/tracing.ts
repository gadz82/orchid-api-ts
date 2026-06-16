export interface TracingOptions {
    enabled: boolean;
    apiKey: string;
    project?: string;
}

export function configureTracing(options: TracingOptions): void {
    if (!options.enabled || !options.apiKey) {
        delete process.env["LANGCHAIN_TRACING_V2"];
        delete process.env["LANGCHAIN_API_KEY"];
        delete process.env["LANGCHAIN_PROJECT"];
        return;
    }

    process.env["LANGCHAIN_TRACING_V2"] = "true";
    process.env["LANGCHAIN_API_KEY"] = options.apiKey;
    process.env["LANGCHAIN_PROJECT"] = options.project || "orchid";
}
