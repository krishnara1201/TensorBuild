import argparse

import uvicorn

from vmb_engine.api import app


def main() -> None:
    parser = argparse.ArgumentParser(prog="tensorbuild-engine")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
