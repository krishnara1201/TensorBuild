IMPORTS = ["import torch", "import torch.nn as nn"]

_ARCH_ERROR = "Train Image Classifier requires a flat architecture; insert a Flatten node first"


def execute(inputs: dict, params: dict, progress_callback=None) -> dict:
    import torch
    import torch.nn as nn

    train_images = inputs["train_images"]["images"]
    train_labels = inputs["train_images"]["labels"]
    test_images = inputs["test_images"]["images"]
    test_labels = inputs["test_images"]["labels"]
    architecture = inputs["architecture"]
    if architecture["in_features"] is None:
        raise ValueError(_ARCH_ERROR)

    model = nn.Sequential(*architecture["modules"])
    loss_fn = getattr(nn, params["loss_fn"])()
    optimizer = getattr(torch.optim, params["optimizer"])(
        model.parameters(), lr=params["learning_rate"]
    )

    batch_size = params["batch_size"]
    n = train_images.shape[0]
    train_loss = 0.0
    val_loss = 0.0
    val_accuracy = 0.0

    for epoch in range(params["epochs"]):
        model.train()
        permutation = torch.randperm(n)
        epoch_loss = 0.0
        for start in range(0, n, batch_size):
            idx = permutation[start : start + batch_size]
            xb, yb = train_images[idx], train_labels[idx]
            optimizer.zero_grad()
            out = model(xb)
            loss = loss_fn(out, yb)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * len(idx)
        train_loss = epoch_loss / n

        model.eval()
        with torch.no_grad():
            val_out = model(test_images)
            val_loss = loss_fn(val_out, test_labels).item()
            val_accuracy = (val_out.argmax(dim=1) == test_labels).float().mean().item()

        if progress_callback is not None:
            progress_callback(
                {"event": "progress", "epoch": epoch, "loss": train_loss, "val_loss": val_loss}
            )

    return {
        "model": {"estimator": model},
        "metrics": {
            "final_train_loss": float(train_loss),
            "final_val_loss": float(val_loss),
            "final_val_accuracy": float(val_accuracy),
        },
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_images"]
    test_in = inputs["test_images"]
    arch_in = inputs["architecture"]
    model_var = var_names["model"]
    metrics_var = var_names["metrics"]
    loss_fn = params["loss_fn"]
    optimizer = params["optimizer"]
    lr = params["learning_rate"]
    epochs = params["epochs"]
    batch_size = params["batch_size"]

    return [
        f"assert {arch_in}_in_features is not None, {_ARCH_ERROR!r}",
        f"{model_var}_module = nn.Sequential(*{arch_in})",
        f"{model_var}_loss_fn = nn.{loss_fn}()",
        f"{model_var}_optimizer = torch.optim.{optimizer}({model_var}_module.parameters(), lr={lr})",
        f"{model_var}_n = {train_in}_images.shape[0]",
        f"{model_var}_train_loss = 0.0",
        f"{model_var}_val_loss = 0.0",
        f"{model_var}_val_accuracy = 0.0",
        f"for {model_var}_epoch in range({epochs}):",
        f"    {model_var}_module.train()",
        f"    {model_var}_permutation = torch.randperm({model_var}_n)",
        f"    {model_var}_epoch_loss = 0.0",
        f"    for {model_var}_start in range(0, {model_var}_n, {batch_size}):",
        f"        {model_var}_idx = "
        f"{model_var}_permutation[{model_var}_start:{model_var}_start + {batch_size}]",
        f"        {model_var}_xb = {train_in}_images[{model_var}_idx]",
        f"        {model_var}_yb = {train_in}_labels[{model_var}_idx]",
        f"        {model_var}_optimizer.zero_grad()",
        f"        {model_var}_out = {model_var}_module({model_var}_xb)",
        f"        {model_var}_loss = {model_var}_loss_fn({model_var}_out, {model_var}_yb)",
        f"        {model_var}_loss.backward()",
        f"        {model_var}_optimizer.step()",
        f"        {model_var}_epoch_loss += {model_var}_loss.item() * len({model_var}_idx)",
        f"    {model_var}_train_loss = {model_var}_epoch_loss / {model_var}_n",
        f"    {model_var}_module.eval()",
        "    with torch.no_grad():",
        f"        {model_var}_val_out = {model_var}_module({test_in}_images)",
        f"        {model_var}_val_loss = {model_var}_loss_fn({model_var}_val_out, {test_in}_labels).item()",
        f"        {model_var}_val_accuracy = ({model_var}_val_out.argmax(dim=1) == "
        f"{test_in}_labels).float().mean().item()",
        f"{model_var} = {{'estimator': {model_var}_module}}",
        f"{metrics_var} = {{'final_train_loss': float({model_var}_train_loss), "
        f"'final_val_loss': float({model_var}_val_loss), "
        f"'final_val_accuracy': float({model_var}_val_accuracy)}}",
        f"print({metrics_var})",
    ]
