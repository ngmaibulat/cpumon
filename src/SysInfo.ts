
export class SysInfo
{
    constructor()
    {
        console.log("Sysinfo constructor");
    }

    getPlatform()
    {
        return "darwin";
    }

    getUptime()
    {
        return 1;
    }

    getCpuCount()
    {
        return 1;
    }

    getProcessUptime()
    {
        return 1;
    }

    getFreeMem()
    {
        return 1;
    }

    getTotalMem()
    {
        return 1;
    }
}
