IMPORTS = ["import pandas as pd"]


def _parse_columns(raw) -> list:
    if not raw:
        return []
    return [c.strip() for c in raw.split(",") if c.strip()]


def execute(inputs: dict, params: dict) -> dict:
    import pandas as pd

    df = inputs["table"].copy()

    drop_columns = _parse_columns(params.get("drop_columns", ""))
    if drop_columns:
        df = df.drop(columns=drop_columns)

    if params.get("strip_whitespace"):
        for col in df.select_dtypes(include=["object", "string"]).columns:
            df[col] = df[col].str.strip()

    if params.get("fix_dtypes"):
        for col in df.select_dtypes(include=["object", "string"]).columns:
            try:
                df[col] = pd.to_numeric(df[col])
            except (ValueError, TypeError):
                pass

    strategy = params.get("missing_value_strategy", "none")
    if strategy != "none":
        cols = _parse_columns(params.get("missing_value_columns", "")) or list(df.columns)
        if strategy == "drop_rows":
            df = df.dropna(subset=cols)
        elif strategy in ("fill_mean", "fill_median"):
            numeric_cols = [c for c in cols if c in df.select_dtypes(include="number").columns]
            for col in numeric_cols:
                stat = df[col].mean() if strategy == "fill_mean" else df[col].median()
                df[col] = df[col].fillna(stat)
        elif strategy == "fill_mode":
            for col in cols:
                mode = df[col].mode(dropna=True)
                if not mode.empty:
                    df[col] = df[col].fillna(mode.iloc[0])
        elif strategy == "fill_constant":
            value = params.get("fill_constant_value", "")
            for col in cols:
                df[col] = df[col].fillna(value)

    if params.get("drop_duplicates"):
        df = df.drop_duplicates()

    return {"table": df}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["table"]
    out_var = var_names["table"]
    lines = [f"{out_var} = {in_var}.copy()"]

    drop_columns = _parse_columns(params.get("drop_columns", ""))
    if drop_columns:
        lines.append(f"{out_var} = {out_var}.drop(columns={drop_columns!r})")

    if params.get("strip_whitespace"):
        lines.append(f"for _col in {out_var}.select_dtypes(include=['object', 'string']).columns:")
        lines.append(f"    {out_var}[_col] = {out_var}[_col].str.strip()")

    if params.get("fix_dtypes"):
        lines.append(f"for _col in {out_var}.select_dtypes(include=['object', 'string']).columns:")
        lines.append("    try:")
        lines.append(f"        {out_var}[_col] = pd.to_numeric({out_var}[_col])")
        lines.append("    except (ValueError, TypeError):")
        lines.append("        pass")

    strategy = params.get("missing_value_strategy", "none")
    if strategy != "none":
        cols = _parse_columns(params.get("missing_value_columns", ""))
        cols_expr = repr(cols) if cols else f"list({out_var}.columns)"
        lines.append(f"{out_var}_cols = {cols_expr}")
        if strategy == "drop_rows":
            lines.append(f"{out_var} = {out_var}.dropna(subset={out_var}_cols)")
        elif strategy in ("fill_mean", "fill_median"):
            stat = "mean" if strategy == "fill_mean" else "median"
            lines.append(
                f"{out_var}_numeric_cols = [c for c in {out_var}_cols "
                f"if c in {out_var}.select_dtypes(include='number').columns]"
            )
            lines.append(f"for _col in {out_var}_numeric_cols:")
            lines.append(f"    {out_var}[_col] = {out_var}[_col].fillna({out_var}[_col].{stat}())")
        elif strategy == "fill_mode":
            lines.append(f"for _col in {out_var}_cols:")
            lines.append(f"    _mode = {out_var}[_col].mode(dropna=True)")
            lines.append("    if not _mode.empty:")
            lines.append(f"        {out_var}[_col] = {out_var}[_col].fillna(_mode.iloc[0])")
        elif strategy == "fill_constant":
            value = params.get("fill_constant_value", "")
            lines.append(f"for _col in {out_var}_cols:")
            lines.append(f"    {out_var}[_col] = {out_var}[_col].fillna({value!r})")

    if params.get("drop_duplicates"):
        lines.append(f"{out_var} = {out_var}.drop_duplicates()")

    return lines
