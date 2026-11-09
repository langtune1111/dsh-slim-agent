#!/usr/bin/env python3
"""遗留脚本：把一批整数分类成 prime/composite（待迁移到新工具链）。"""


def is_prime(n: int) -> bool:
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True


def classify(values):
    return ["prime" if is_prime(v) else "composite" for v in values]


if __name__ == "__main__":
    print(classify([91, 97, 100, 101]))
