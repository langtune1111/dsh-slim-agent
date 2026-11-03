## A. 固定开销（首轮 prompt tokens）

| 模型 | 模式 | 工具数 | 首轮 prompt tokens | 占 8K | 占 4K | 占 2K |
|---|---|---|---|---|---|---|
| lfm3-1.7b-q5 | slim-agent | 6 | 1289 | 15.7% | 31.5% | 62.9% |
| lfm3-1.7b-q5 | 标准 | 24 | 6073 | 74.1% | 148.3% | 296.5% |
| lfm3-1.7b-q5 | 极简 | 2 | 895 | 10.9% | 21.9% | 43.7% |
| lfm3-1.7b-q5 | pi-agent | 4 | 1441 | 17.6% | 35.2% | 70.4% |
| qwen35-4b-q4km | slim-agent | 6 | 1401 | 17.1% | 34.2% | 68.4% |
| qwen35-4b-q4km | 标准 | 24 | 6186 | 75.5% | 151.0% | 302.1% |
| qwen35-4b-q4km | 极简 | 2 | 974 | 11.9% | 23.8% | 47.6% |
| qwen35-4b-q4km | pi-agent | 4 | 1567 | 19.1% | 38.3% | 76.5% |

## B. 通过率（T1 文件工具 + T2 读文件取数，2 项合计）

**lfm3-1.7b-q5**

| 模式 | 2K | 4K | 8K | 64K | 256K |
|---|---|---|---|---|---|
| slim-agent | 0/2 | 0/2 | 1/2 | 1/2 | 2/2 |
| 标准 | 0/2 | 0/2 | 0/2 | 2/2 | 1/2 |
| 极简 | 0/2 | 0/2 | 2/2 | 2/2 | 2/2 |
| pi-agent | 0/2 | 0/2 | 2/2 | 2/2 | 2/2 |

**qwen35-4b-q4km**

| 模式 | 2K | 4K | 8K | 64K | 256K |
|---|---|---|---|---|---|
| slim-agent | 0/2 | 0/2 | 1/2 | 1/2 | N/A |
| 标准 | 0/2 | 0/2 | 0/2 | 1/2 | N/A |
| 极简 | 0/2 | 0/2 | 2/2 | 2/2 | N/A |
| pi-agent | 0/2 | 0/2 | 2/2 | 2/2 | N/A |

## C. 端到端耗时（秒，T1+T2 合计）

| 模型 | 窗口 | slim-agent | 标准 | 极简 | pi-agent |
|---|---|---|---|---|
| lfm3-1.7b-q5 | 2K | 25 | 25 | 23 | 9 |
| lfm3-1.7b-q5 | 4K | 25 | 25 | 24 | 10 |
| lfm3-1.7b-q5 | 8K | 82 | 48 | 58 | 22 |
| lfm3-1.7b-q5 | 64K | 86 | 81 | 55 | 62 |
| lfm3-1.7b-q5 | 256K | 43 | 68 | 53 | 90 |
| qwen35-4b-q4km | 2K | 36 | 26 | 26 | 17 |
| qwen35-4b-q4km | 4K | 29 | 26 | 26 | 16 |
| qwen35-4b-q4km | 8K | 85 | 133 | 120 | 43 |
| qwen35-4b-q4km | 64K | 125 | 254 | 154 | 50 |
| qwen35-4b-q4km | 256K | N/A | N/A | N/A | N/A |

## D. 逐次明细

| run | 模型 | 模式 | 窗口 | 任务 | 判定 | 工具 | prompt | 输出tok | 端到端s | finish |
|---|---|---|---|---|---|---|---|---|---|---|
| minimal__2048__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 极简 | 2K | T1 | FAIL | 2 | 895 | 1 | 12.2 | length |
| minimal__2048__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 极简 | 2K | T2 | FAIL | 2 | 862 | 1 | 11.2 | length |
| pi__2048__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | pi-agent | 2K | T1 | FAIL | 4 | 1441 | 1 | 4.8 | length |
| pi__2048__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | pi-agent | 2K | T2 | FAIL | 4 | 1408 | 1 | 4.6 | length |
| slim__2048__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | slim-agent | 2K | T1 | FAIL | 6 | 1289 | 1 | 13.3 | length |
| slim__2048__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | slim-agent | 2K | T2 | FAIL | 6 | 1256 | 1 | 11.3 | length |
| standard__2048__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 标准 | 2K | T1 | FAIL | 24 | 0 | 0 | 12.6 | None |
| standard__2048__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 标准 | 2K | T2 | FAIL | 24 | 0 | 0 | 12.5 | None |
| minimal__4096__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 极简 | 4K | T1 | FAIL | 2 | 895 | 1 | 12.2 | length |
| minimal__4096__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 极简 | 4K | T2 | FAIL | 2 | 862 | 1 | 11.5 | length |
| pi__4096__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | pi-agent | 4K | T1 | FAIL | 4 | 1441 | 1 | 5.0 | length |
| pi__4096__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | pi-agent | 4K | T2 | FAIL | 4 | 1408 | 1 | 4.6 | length |
| slim__4096__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | slim-agent | 4K | T1 | FAIL | 6 | 1289 | 1 | 13.5 | length |
| slim__4096__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | slim-agent | 4K | T2 | FAIL | 6 | 1256 | 1 | 11.4 | length |
| standard__4096__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 标准 | 4K | T1 | FAIL | 24 | 0 | 0 | 12.8 | None |
| standard__4096__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 标准 | 4K | T2 | FAIL | 24 | 0 | 0 | 12.5 | None |
| minimal__8192__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 极简 | 8K | T1 | PASS | 2 | 895 | 591 | 38.6 | stop |
| minimal__8192__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 极简 | 8K | T2 | PASS | 2 | 862 | 124 | 19.1 | stop |
| pi__8192__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | pi-agent | 8K | T1 | PASS | 4 | 1441 | 273 | 14.2 | stop |
| pi__8192__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | pi-agent | 8K | T2 | PASS | 4 | 1408 | 36 | 7.8 | stop |
| slim__8192__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | slim-agent | 8K | T1 | PASS | 6 | 1289 | 329 | 64.8 | stop |
| slim__8192__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | slim-agent | 8K | T2 | FAIL | 6 | 1256 | 140 | 16.9 | tool_calls |
| standard__8192__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 标准 | 8K | T1 | FAIL | 24 | 6073 | 1 | 24.0 | length |
| standard__8192__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 标准 | 8K | T2 | FAIL | 24 | 6040 | 1 | 24.5 | length |
| minimal__65536__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 极简 | 64K | T1 | PASS | 2 | 895 | 525 | 37.3 | stop |
| minimal__65536__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 极简 | 64K | T2 | PASS | 2 | 862 | 121 | 18.0 | stop |
| pi__65536__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | pi-agent | 64K | T1 | PASS | 4 | 1441 | 1426 | 54.3 | stop |
| pi__65536__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | pi-agent | 64K | T2 | PASS | 4 | 1408 | 38 | 7.8 | stop |
| slim__65536__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | slim-agent | 64K | T1 | PASS | 6 | 1289 | 277 | 68.6 | stop |
| slim__65536__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | slim-agent | 64K | T2 | FAIL | 6 | 1256 | 140 | 17.5 | tool_calls |
| standard__65536__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 标准 | 64K | T1 | PASS | 24 | 6073 | 471 | 48.6 | stop |
| standard__65536__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 标准 | 64K | T2 | PASS | 24 | 6040 | 121 | 32.8 | stop |
| minimal__262144__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 极简 | 256K | T1 | PASS | 2 | 895 | 443 | 33.4 | stop |
| minimal__262144__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 极简 | 256K | T2 | PASS | 2 | 862 | 144 | 20.0 | stop |
| pi__262144__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | pi-agent | 256K | T1 | PASS | 4 | 1441 | 1560 | 81.0 | stop |
| pi__262144__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | pi-agent | 256K | T2 | PASS | 4 | 1408 | 83 | 9.0 | stop |
| slim__262144__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | slim-agent | 256K | T1 | PASS | 6 | 1289 | 266 | 25.5 | stop |
| slim__262144__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | slim-agent | 256K | T2 | PASS | 6 | 1256 | 83 | 17.7 | stop |
| standard__262144__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 标准 | 256K | T1 | FAIL | 24 | 6073 | 400 | 35.9 | stop |
| standard__262144__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 标准 | 256K | T2 | PASS | 24 | 6040 | 166 | 31.9 | stop |
| minimal__2048__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 极简 | 2K | T1 | FAIL | 2 | 972 | 1 | 14.9 | length |
| minimal__2048__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 极简 | 2K | T2 | FAIL | 2 | 935 | 1 | 11.3 | length |
| pi__2048__qwen35-4b-q4km__T1 | qwen35-4b-q4km | pi-agent | 2K | T1 | FAIL | 4 | 1566 | 1 | 8.2 | length |
| pi__2048__qwen35-4b-q4km__T2 | qwen35-4b-q4km | pi-agent | 2K | T2 | FAIL | 4 | 1529 | 1 | 8.4 | length |
| slim__2048__qwen35-4b-q4km__T1 | qwen35-4b-q4km | slim-agent | 2K | T1 | FAIL | 6 | 1399 | 1 | 22.3 | length |
| slim__2048__qwen35-4b-q4km__T2 | qwen35-4b-q4km | slim-agent | 2K | T2 | FAIL | 6 | 1362 | 1 | 13.5 | length |
| standard__2048__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 标准 | 2K | T1 | FAIL | 24 | 0 | 0 | 12.9 | None |
| standard__2048__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 标准 | 2K | T2 | FAIL | 24 | 0 | 0 | 12.6 | None |
| minimal__4096__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 极简 | 4K | T1 | FAIL | 2 | 972 | 1 | 14.3 | length |
| minimal__4096__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 极简 | 4K | T2 | FAIL | 2 | 935 | 1 | 11.8 | length |
| pi__4096__qwen35-4b-q4km__T1 | qwen35-4b-q4km | pi-agent | 4K | T1 | FAIL | 4 | 1566 | 1 | 8.3 | length |
| pi__4096__qwen35-4b-q4km__T2 | qwen35-4b-q4km | pi-agent | 4K | T2 | FAIL | 4 | 1529 | 1 | 8.2 | length |
| slim__4096__qwen35-4b-q4km__T1 | qwen35-4b-q4km | slim-agent | 4K | T1 | FAIL | 6 | 1399 | 1 | 17.0 | length |
| slim__4096__qwen35-4b-q4km__T2 | qwen35-4b-q4km | slim-agent | 4K | T2 | FAIL | 6 | 1362 | 1 | 12.2 | length |
| standard__4096__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 标准 | 4K | T1 | FAIL | 24 | 0 | 0 | 13.1 | None |
| standard__4096__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 标准 | 4K | T2 | FAIL | 24 | 0 | 0 | 12.4 | None |
| minimal__8192__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 极简 | 8K | T1 | PASS | 2 | 972 | 946 | 89.8 | stop |
| minimal__8192__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 极简 | 8K | T2 | PASS | 2 | 935 | 166 | 29.8 | stop |
| pi__8192__qwen35-4b-q4km__T1 | qwen35-4b-q4km | pi-agent | 8K | T1 | PASS | 4 | 1566 | 519 | 28.0 | stop |
| pi__8192__qwen35-4b-q4km__T2 | qwen35-4b-q4km | pi-agent | 8K | T2 | PASS | 4 | 1529 | 101 | 14.7 | stop |
| slim__8192__qwen35-4b-q4km__T1 | qwen35-4b-q4km | slim-agent | 8K | T1 | FAIL | 6 | 1399 | 517 | 58.2 | tool_calls |
| slim__8192__qwen35-4b-q4km__T2 | qwen35-4b-q4km | slim-agent | 8K | T2 | PASS | 6 | 1362 | 92 | 27.1 | stop |
| standard__8192__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 标准 | 8K | T1 | FAIL | 24 | 6184 | 1 | 98.8 | length |
| standard__8192__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 标准 | 8K | T2 | FAIL | 24 | 6147 | 1 | 34.1 | length |
| minimal__65536__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 极简 | 64K | T1 | PASS | 2 | 974 | 893 | 80.5 | stop |
| minimal__65536__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 极简 | 64K | T2 | PASS | 2 | 937 | 104 | 73.4 | stop |
| pi__65536__qwen35-4b-q4km__T1 | qwen35-4b-q4km | pi-agent | 64K | T1 | PASS | 4 | 1567 | 790 | 35.8 | stop |
| pi__65536__qwen35-4b-q4km__T2 | qwen35-4b-q4km | pi-agent | 64K | T2 | PASS | 4 | 1530 | 113 | 14.6 | stop |
| slim__65536__qwen35-4b-q4km__T1 | qwen35-4b-q4km | slim-agent | 64K | T1 | FAIL | 6 | 1401 | 484 | 94.6 | tool_calls |
| slim__65536__qwen35-4b-q4km__T2 | qwen35-4b-q4km | slim-agent | 64K | T2 | PASS | 6 | 1364 | 115 | 30.3 | stop |
| standard__65536__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 标准 | 64K | T1 | FAIL | 24 | 6186 | 4096 | 214.1 | length |
| standard__65536__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 标准 | 64K | T2 | PASS | 24 | 6149 | 130 | 40.2 | stop |
