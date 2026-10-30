# LabelImg integration

LabelImg is optional. In **Settings → External Tools · LabelImg**, select the directory containing `labelImg.py`. Boundary Vision remembers that directory in the per-user settings file and validates the script before saving it.

Choose **Open LabelImg** to launch the editor directly. This action does not ask for an image or dataset directory; LabelImg opens and its own UI controls image and annotation folders. Boundary Vision checks only the dedicated `.venv` inside the selected LabelImg folder and uses it only when Python 3 plus `PyQt5` and `lxml` import successfully. It does not apply a fixed upper Python version limit, use another interpreter, or change the inference-worker environment. If the environment is missing or dependencies fail to import, install Python 3 and create the environment with `py -3 -m venv .venv` in the LabelImg folder, then install dependencies with `.venv\Scripts\python -m pip install PyQt5 lxml`. Python downloads are available from <https://www.python.org/downloads/windows/>.

## Open an image inference result

After image inference, choose **Open in LabelImg** to export the current detections as YOLO TXT or Pascal VOC XML and launch LabelImg. The export is created in a uniquely named `boundary-vision-labelimg` folder under the already selected Boundary Vision output directory (with a numeric suffix if needed). It does not open another directory picker. Boundary Vision copies the original source images and writes matching annotation files plus `classes.txt`; it leaves existing output files intact. YOLO annotations use normalized center coordinates and the model's class ID/name ordering. Pascal VOC annotations use pixel coordinates, class names, dimensions, and the copied image filenames.

This dataset export uses detections from the current session, even if the original inference run selected only annotated previews or CreateML. CreateML JSON and video frame annotations are not converted into LabelImg datasets. Video frame annotations remain in their generated frame directory.

## Dependencies and recovery

Boundary Vision keeps LabelImg separate from its inference worker. It does not download a Python runtime or LabelImg dependencies. The user creates the isolated environment in the LabelImg folder; Boundary Vision discovers and validates it on launch. If the configured LabelImg folder moved, select its new location in Settings.
