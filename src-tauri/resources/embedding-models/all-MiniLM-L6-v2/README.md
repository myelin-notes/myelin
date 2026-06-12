---
license: apache-2.0
pipeline_tag: sentence-similarity
---

ONNX port of [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) for text classification and similarity searches.

`model.onnx` is the int8 dynamically quantized variant (`onnx/model_quantized.onnx`) from [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2). The tokenizer files are identical across the fp32 and quantized ports.
