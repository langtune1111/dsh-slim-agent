import sys


def fib(n):
    a, b = 1, 1
    out = []
    for _ in range(n):
        out.append(a)
        a, b = b, a + b
    return out


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    for value in fib(n):
        print(value)
