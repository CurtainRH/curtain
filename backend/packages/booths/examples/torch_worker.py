"""Local-only PyTorch/Transformers inference adapter example for Booths."""
import json
import os
from pathlib import Path
import sys


def reply(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")))


def main():
    request = json.loads(sys.stdin.read())
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as exc:
        raise RuntimeError("Install PyTorch and Transformers in this worker environment") from exc

    if not torch.cuda.is_available():
        raise RuntimeError("No CUDA GPU detected; this example does not silently fall back to CPU")

    if request.get("operation") == "capabilities":
        reply({"provider": "pytorch-transformers", "devices": [torch.cuda.get_device_name(0)], "tasks": ["inference"]})
        return

    workload = request.get("workload", {})
    if workload.get("task") != "inference":
        raise ValueError("This example worker supports only the inference task")
    model_root = Path(os.environ["BOOTHS_MODEL_DIR"]).resolve()
    model_path = (model_root / workload.get("model", "")).resolve()
    if model_root not in model_path.parents and model_path != model_root:
        raise ValueError("Model identifier must resolve inside BOOTHS_MODEL_DIR")
    if not model_path.exists():
        raise FileNotFoundError("The requested model directory is not installed locally")

    prompt = workload.get("input", {}).get("prompt")
    if not isinstance(prompt, str) or not prompt or len(prompt) > 12_000:
        raise ValueError("input.prompt must be a non-empty string up to 12,000 characters")
    max_new_tokens = workload.get("options", {}).get("maxNewTokens", 128)
    if not isinstance(max_new_tokens, int) or not 1 <= max_new_tokens <= 2048:
        raise ValueError("options.maxNewTokens must be an integer from 1 to 2048")

    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(model_path, local_files_only=True, trust_remote_code=False).to("cuda")
    encoded = tokenizer(prompt, return_tensors="pt").to("cuda")
    with torch.inference_mode():
        generated = model.generate(**encoded, max_new_tokens=max_new_tokens)
    text = tokenizer.decode(generated[0][encoded["input_ids"].shape[1]:], skip_special_tokens=True)
    reply({"output": {"text": text}, "usage": {"outputTokens": int(generated.shape[1] - encoded["input_ids"].shape[1])}})


try:
    main()
except Exception as error:
    # Do not emit prompts or model data. The TS adapter reports only exit status to its caller.
    sys.stderr.write(f"Booths CUDA worker error: {type(error).__name__}\n")
    sys.exit(1)
