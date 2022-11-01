
export type CpuInfo = {
    model: string;
    idle: number;
    load: number;
    total: number;
    loadRatio?: number;
    loadPercentage?: number;
}

export type LoadInfo = {
    current: Array<CpuInfo>;
    load: Array<CpuInfo>;
}

export type StrFunction = (str: string) => string;
