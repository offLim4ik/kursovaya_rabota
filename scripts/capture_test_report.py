"""Capture the locally generated HTML Pytest report with Microsoft Edge."""

from __future__ import annotations

import argparse
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.edge.options import Options
from selenium.webdriver.support.ui import WebDriverWait


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="Local HTML report")
    parser.add_argument("screenshot", type=Path, help="PNG screenshot path")
    args = parser.parse_args()

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--hide-scrollbars")
    driver = webdriver.Edge(options=options)
    try:
        driver.set_window_size(1700, 1700)
        driver.get(args.report.resolve().as_uri())
        WebDriverWait(driver, 15).until(lambda browser: browser.execute_script("return document.readyState") == "complete")
        height = driver.execute_script("return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)")
        driver.set_window_size(1700, max(1000, min(2600, height + 60)))
        args.screenshot.parent.mkdir(parents=True, exist_ok=True)
        if not driver.save_screenshot(str(args.screenshot)):
            raise RuntimeError("Microsoft Edge did not save the screenshot")
    finally:
        driver.quit()
    print(f"Снимок отчёта сохранён: {args.screenshot}")


if __name__ == "__main__":
    main()
