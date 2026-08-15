# Keys

Press `?` inside the dashboard for the same list. It is generated from the
binding table that dispatches the keys, so it cannot describe one that does
nothing.

## Screens

See [Screens](./screens) for what each one shows.

| Key | Action |
| --- | --- |
| `Tab` `Shift-Tab` | go to the next or previous screen |
| `1` … `6` | focus cpu, memory, disk, network, processes, containers — dashboard only |
| `w` `W` | focus the next or previous panel — dashboard only |

::: warning Changed in 0.2.0
`Tab` used to cycle panel focus. It now cycles screens, and panel focus moved to
`w` / `W`. The number keys are unchanged, but they only do anything on the
dashboard, since every other screen is one view filling the frame.
:::

## Anywhere

| Key | Action |
| --- | --- |
| `q` `Ctrl-C` | quit |
| `?` `F1` | show or hide the help |
| `Esc` | close an overlay, cancel a filter, unmaximise, then return to the dashboard |
| `Space` | freeze the view; sampling continues underneath |
| `+` `-` | halve or double the sampling interval |
| `f` | maximise the focused panel — dashboard only |
| `r` | clear history, unpause, drop the filter |
| `t` | cycle the colour theme |
| `Ctrl-G` | cycle the graph style: block, braille, ascii |

## Any list

Wherever there is a table with a cursor — the process, container, connections,
stacks and units tables, on the dashboard or full screen. The wifi scan list has
no cursor, because the only thing it would be for is connecting.

| Key | Action |
| --- | --- |
| `j` `k` `↑` `↓` | move the selection |
| `Ctrl-D` `Ctrl-U` `PgUp` `PgDn` | page the selection |
| `g` `G` `Home` `End` | jump to the first or last row |

## Processes

| Key | Action |
| --- | --- |
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
