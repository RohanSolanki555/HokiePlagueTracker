"""Shared report-window validation. None means no lower date bound."""


def parse_days(value):
    if value == "all":
        return None
    try:
        days = int(value)
    except ValueError:
        raise ValueError("days must be an integer from 1 to 30, or all") from None
    if not 1 <= days <= 30:
        raise ValueError("days must be an integer from 1 to 30, or all")
    return days
