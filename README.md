### Library and a CLI tool to monitor CPU usage

### The goal:
The goal is to provide API to monitor CPU usage accross all
available CPU cores. You can provide sampling interval.
And subscribe to `cpudata` events which would be generated
according to the provided sampling interval. The event would
also have the data of cpu usage percentage for each cpu core.

### Use CLI tool:

```sh
npx cpumon@latest
```

### Use the Library
The API of the Library is yet to be finalized and documented. Don't use it for now.
