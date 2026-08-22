_ADAPTER_CLASS_SRC = (
    "class _TorchPredictAdapter:\n"
    "    def __init__(self, module, task_type):\n"
    "        self.module = module\n"
    "        self.task_type = task_type\n"
    "\n"
    "    def predict(self, X):\n"
    "        self.module.eval()\n"
    "        with torch.no_grad():\n"
    "            out = self.module(torch.tensor(X.values, dtype=torch.float32))\n"
    "        if self.task_type == 'classification':\n"
    "            return out.argmax(dim=1).numpy()\n"
    "        return out.squeeze(-1).numpy()"
)

IMPORTS = ["import torch", "import torch.nn as nn", _ADAPTER_CLASS_SRC]


class _TorchPredictAdapter:
    def __init__(self, module, task_type):
        self.module = module
        self.task_type = task_type

    def predict(self, X):
        import torch

        self.module.eval()
        with torch.no_grad():
            out = self.module(torch.tensor(X.values, dtype=torch.float32))
        if self.task_type == "classification":
            return out.argmax(dim=1).numpy()
        return out.squeeze(-1).numpy()


def execute(inputs: dict, params: dict, progress_callback=None) -> dict:
    import torch
    import torch.nn as nn

    target = params["target_column"]
    task_type = params["task_type"]
    train_df = inputs["train_table"]
    test_df = inputs["test_table"]
    architecture = inputs["architecture"]

    feature_columns = [c for c in train_df.columns if c != target]
    model = nn.Sequential(*architecture["modules"])

    X_train = torch.tensor(train_df[feature_columns].values, dtype=torch.float32)
    X_test = torch.tensor(test_df[feature_columns].values, dtype=torch.float32)
    if task_type == "classification":
        y_train = torch.tensor(train_df[target].values, dtype=torch.long)
        y_test = torch.tensor(test_df[target].values, dtype=torch.long)
    else:
        y_train = torch.tensor(train_df[target].values, dtype=torch.float32).unsqueeze(-1)
        y_test = torch.tensor(test_df[target].values, dtype=torch.float32).unsqueeze(-1)

    loss_fn = getattr(nn, params["loss_fn"])()
    optimizer = getattr(torch.optim, params["optimizer"])(
        model.parameters(), lr=params["learning_rate"]
    )

    batch_size = params["batch_size"]
    n = X_train.shape[0]
    train_loss = 0.0
    val_loss = 0.0

    for epoch in range(params["epochs"]):
        model.train()
        permutation = torch.randperm(n)
        epoch_loss = 0.0
        for start in range(0, n, batch_size):
            idx = permutation[start : start + batch_size]
            xb, yb = X_train[idx], y_train[idx]
            optimizer.zero_grad()
            out = model(xb)
            loss = loss_fn(out, yb)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * len(idx)
        train_loss = epoch_loss / n

        model.eval()
        with torch.no_grad():
            val_loss = loss_fn(model(X_test), y_test).item()

        if progress_callback is not None:
            progress_callback(
                {"event": "progress", "epoch": epoch, "loss": train_loss, "val_loss": val_loss}
            )

    estimator = _TorchPredictAdapter(model, task_type)
    return {
        "model": {"estimator": estimator, "feature_columns": feature_columns},
        "metrics": {"final_train_loss": float(train_loss), "final_val_loss": float(val_loss)},
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_table"]
    test_in = inputs["test_table"]
    arch_in = inputs["architecture"]
    model_var = var_names["model"]
    metrics_var = var_names["metrics"]
    target = params["target_column"]
    task_type = params["task_type"]
    loss_fn = params["loss_fn"]
    optimizer = params["optimizer"]
    lr = params["learning_rate"]
    epochs = params["epochs"]
    batch_size = params["batch_size"]

    y_dtype = "torch.long" if task_type == "classification" else "torch.float32"
    unsqueeze = "" if task_type == "classification" else ".unsqueeze(-1)"

    return [
        f"{model_var}_target = {target!r}",
        f"{model_var}_X = {train_in}.drop(columns=[{model_var}_target])",
        f"{model_var}_feature_columns = list({model_var}_X.columns)",
        f"{model_var}_module = nn.Sequential(*{arch_in})",
        f"{model_var}_X_train = torch.tensor({model_var}_X.values, dtype=torch.float32)",
        f"{model_var}_X_test = torch.tensor({test_in}[{model_var}_feature_columns].values, dtype=torch.float32)",
        f"{model_var}_y_train = torch.tensor({train_in}[{model_var}_target].values, dtype={y_dtype}){unsqueeze}",
        f"{model_var}_y_test = torch.tensor({test_in}[{model_var}_target].values, dtype={y_dtype}){unsqueeze}",
        f"{model_var}_loss_fn = nn.{loss_fn}()",
        f"{model_var}_optimizer = torch.optim.{optimizer}({model_var}_module.parameters(), lr={lr})",
        f"{model_var}_n = {model_var}_X_train.shape[0]",
        f"{model_var}_train_loss = 0.0",
        f"{model_var}_val_loss = 0.0",
        f"for {model_var}_epoch in range({epochs}):",
        f"    {model_var}_module.train()",
        f"    {model_var}_permutation = torch.randperm({model_var}_n)",
        f"    {model_var}_epoch_loss = 0.0",
        f"    for {model_var}_start in range(0, {model_var}_n, {batch_size}):",
        f"        {model_var}_idx = {model_var}_permutation[{model_var}_start:{model_var}_start + {batch_size}]",
        f"        {model_var}_xb = {model_var}_X_train[{model_var}_idx]",
        f"        {model_var}_yb = {model_var}_y_train[{model_var}_idx]",
        f"        {model_var}_optimizer.zero_grad()",
        f"        {model_var}_out = {model_var}_module({model_var}_xb)",
        f"        {model_var}_loss = {model_var}_loss_fn({model_var}_out, {model_var}_yb)",
        f"        {model_var}_loss.backward()",
        f"        {model_var}_optimizer.step()",
        f"        {model_var}_epoch_loss += {model_var}_loss.item() * len({model_var}_idx)",
        f"    {model_var}_train_loss = {model_var}_epoch_loss / {model_var}_n",
        f"    {model_var}_module.eval()",
        "    with torch.no_grad():",
        f"        {model_var}_val_loss = {model_var}_loss_fn({model_var}_module({model_var}_X_test), {model_var}_y_test).item()",
        f"{model_var} = _TorchPredictAdapter({model_var}_module, {task_type!r})",
        f"{metrics_var} = {{'final_train_loss': float({model_var}_train_loss), "
        f"'final_val_loss': float({model_var}_val_loss)}}",
    ]
