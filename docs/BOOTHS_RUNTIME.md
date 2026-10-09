# Booths — experimental, cloneable compute runtime

Booths is code integrators clone or vendor into their own services. It is not a hosted Curtain API: the runtime executes in-process, and the integrator connects hardware by implementing a provider. The current example attaches a local CUDA-enabled PyTorch/Transformers worker; developers can replace it with their own GPU or accelerator adapter.

The runtime is hardware-neutral and tested with a CPU mock. Curtain does not supply GPUs, a hosted model, a job queue, attestation, billing, or a privacy guarantee. Do not describe the example as confidential compute. The CUDA path requires a compatible local GPU, driver, dependencies, and locally installed model weights.

Start at [`backend/packages/booths/README.md`](../backend/packages/booths/README.md) for clone/use instructions and the provider interface. This feature is experimental and currently supports inference in the included CUDA example; fine-tuning and managed hardware are not implemented.
