from __future__ import annotations

import torch


def available_devices() -> list[dict[str, str]]:
    devices = [{"id": "cpu", "label": "CPU"}]
    try:
        if torch.cuda.is_available():
            probe = torch.zeros(1, device="cuda")
            torch.cuda.synchronize()
            del probe
            devices.append({"id": "cuda:0", "label": f"CUDA — {torch.cuda.get_device_name(0)}"})
    except Exception:
        pass
    return devices


def validate_device(device: str) -> str:
    supported = {item["id"] for item in available_devices()}
    if device not in supported:
        raise ValueError(f"Device '{device}' is not available in this Python runtime.")
    return device
