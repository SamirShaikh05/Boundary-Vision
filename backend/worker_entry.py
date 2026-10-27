import os

os.environ["YOLO_AUTOINSTALL"] = "false"

from app.worker import main


if __name__ == "__main__":
    main()
