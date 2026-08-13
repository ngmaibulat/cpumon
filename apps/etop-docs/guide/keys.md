# Keys

Press `?` inside the dashboard for the same list. It is generated from the
binding table that dispatches the keys, so it cannot describe one that does
nothing.

## Anywhere

| Key | Action |
| --- | --- |
| `q` `Ctrl-C` | quit |
| `?` `F1` | show or hide the help |
| `Esc` | close an overlay, cancel a filter, unmaximise |
| `Tab` `Shift-Tab` | focus the next or previous panel |
| `1` … `6` | focus cpu, memory, disk, network, processes, containers |
| `Space` | freeze the view; sampling continues underneath |
| `+` `-` | halve or double the sampling interval |
| `f` | maximise the focused panel |
| `r` | clear history, unpause, drop the filter |
| `t` | cycle the colour theme |
| `Ctrl-G` | cycle the graph style: block, braille, ascii |

## Processes

| Key | Action |
| --- | --- |
| `j` `k` `↑` `↓` | move the selection |
| `Ctrl-D` `Ctrl-U` `PgUp` `PgDn` | page the selection |
| `g` `G` `Home` `End` | jump to the first or last row |
| `c` `m` `p` `n` `s` | sort by cpu, memory, pid, name, threads |
| `<` `>` | move the sort one column left or right |
| `R` | reverse the sort |
| `/` | filter by name or pid |
| `Enter` | expand the selected row |
| `K` | send a signal to the selected process |

## Network

| Key | Action |
| --- | --- |
| `←` `→` | cycle the interface |
| `u` | show throughput in bits or bytes |
