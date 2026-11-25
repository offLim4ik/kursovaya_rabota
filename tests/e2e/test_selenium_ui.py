"""Browser-level smoke and learning-flow tests against an isolated demo database."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path
from threading import Thread

import pytest
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.edge.options import Options
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from werkzeug.serving import make_server

from platform_app import create_app
from platform_app.db import migrate


@pytest.fixture(scope="session")
def live_app(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    """Start an isolated Flask/SQLite server seeded with the real demo catalog."""
    temp = tmp_path_factory.mktemp("selenium-platform")
    app = create_app({
        "TESTING": False,
        "SECRET_KEY": "selenium-only-test-secret",
        "DATABASE": str(temp / "platform.sqlite3"),
        "UPLOAD_FOLDER": str(temp / "uploads"),
    })
    with app.app_context():
        migrate()
    runner = app.test_cli_runner()
    for command in (
        "seed-demo", "upgrade-demo", "enrich-demo", "add-extra-courses", "fill-course-library"
    ):
        result = runner.invoke(args=[command])
        assert result.exit_code == 0, f"Команда {command} завершилась ошибкой:\n{result.output}"

    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        thread.join(timeout=5)


@pytest.fixture()
def browser(live_app: str) -> Iterator[webdriver.Edge]:
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--window-size=1440,1100")
    options.add_argument("--disable-gpu")
    driver = webdriver.Edge(options=options)
    driver.set_window_size(1440, 1100)
    driver.implicitly_wait(1)
    driver.get(live_app)
    WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.CSS_SELECTOR, "#header nav")))
    yield driver
    driver.quit()


@pytest.fixture()
def capture(browser: webdriver.Edge, request: pytest.FixtureRequest):
    evidence = Path(__file__).resolve().parents[2] / "output" / "evidence" / "selenium"
    evidence.mkdir(parents=True, exist_ok=True)

    def save(name: str) -> Path:
        path = evidence / f"{request.node.name}_{name}.png"
        assert browser.save_screenshot(str(path))
        return path

    return save


def wait_main(browser: webdriver.Edge):
    return WebDriverWait(browser, 20).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, "#main h1"))
    )


def test_catalog_shows_eighteen_courses_and_six_cards(browser: webdriver.Edge, capture) -> None:
    browser.get(browser.current_url.rstrip("/") + "/courses")
    wait_main(browser)
    WebDriverWait(browser, 20).until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".catalog-results .card")) == 6)
    assert browser.find_element(By.CSS_SELECTOR, ".catalog-results .count strong").text == "18"
    assert len(browser.find_elements(By.CSS_SELECTOR, ".catalog-results .card")) == 6
    capture("каталог")


def test_catalog_search_returns_matching_course(browser: webdriver.Edge, capture) -> None:
    browser.get(browser.current_url.rstrip("/") + "/courses")
    wait_main(browser)
    search = browser.find_element(By.CSS_SELECTOR, '#catalog-form input[name="q"]')
    search.send_keys("Python")
    search.send_keys(Keys.ENTER)
    WebDriverWait(browser, 20).until(lambda d: "q=Python" in d.current_url)
    WebDriverWait(browser, 20).until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".catalog-results .card")) > 0)
    titles = [el.text for el in browser.find_elements(By.CSS_SELECTOR, ".catalog-results .card h3")]
    assert any("Python" in title for title in titles)
    capture("поиск")


def test_fresh_catalog_visit_resets_saved_filters(browser: webdriver.Edge) -> None:
    browser.execute_script("localStorage.setItem('vector-catalog-filters', JSON.stringify({q:'несуществующий запрос',level:'Продвинутый',status:'favorite',sort:'popular'}))")
    browser.get(browser.current_url.rstrip("/") + "/courses")
    wait_main(browser)
    assert browser.find_element(By.CSS_SELECTOR, '#catalog-form input[name="q"]').get_attribute("value") == ""
    assert browser.find_element(By.CSS_SELECTOR, '#catalog-form select[name="level"]').get_attribute("value") == ""
    assert browser.find_element(By.CSS_SELECTOR, '#catalog-form select[name="status"]').get_attribute("value") == ""
    assert browser.find_element(By.CSS_SELECTOR, '#catalog-form select[name="sort"]').get_attribute("value") == "new"
    assert browser.find_element(By.CSS_SELECTOR, ".catalog-results .count strong").text == "18"


def test_mobile_catalog_fits_viewport(browser: webdriver.Edge, capture) -> None:
    browser.set_window_size(390, 844)
    browser.get(browser.current_url.rstrip("/") + "/courses")
    wait_main(browser)
    assert browser.execute_script("return document.documentElement.scrollWidth <= window.innerWidth")
    assert browser.find_element(By.CSS_SELECTOR, ".catalog-controls").is_displayed()
    capture("мобильный-каталог")


def test_course_description_displays_outcomes_and_program(browser: webdriver.Edge, capture) -> None:
    browser.get(browser.current_url.rstrip("/") + "/courses")
    wait_main(browser)
    course_link = browser.find_element(By.CSS_SELECTOR, ".catalog-results .card h3 a")
    browser.execute_script("arguments[0].scrollIntoView({block:'center'}); arguments[0].click();", course_link)
    wait_main(browser)
    assert browser.find_element(By.CSS_SELECTOR, ".detail-hero h1").text
    assert browser.find_element(By.XPATH, "//h3[contains(., 'Чему вы научитесь')]").is_displayed()
    assert browser.find_element(By.XPATH, "//h2[contains(., 'Программа курса')]").is_displayed()
    capture("страница-курса")


def test_registration_opens_personal_dashboard(browser: webdriver.Edge, capture) -> None:
    browser.get(browser.current_url.rstrip("/") + "/register")
    wait_main(browser)
    suffix = str(time.time_ns())
    browser.find_element(By.CSS_SELECTOR, '#register-form input[name="name"]').send_keys("Тест Selenium")
    browser.find_element(By.CSS_SELECTOR, '#register-form input[name="email"]').send_keys(f"selenium-{suffix}@example.test")
    browser.find_element(By.CSS_SELECTOR, '#register-form input[name="password"]').send_keys("Selenium-pass-123")
    browser.find_element(By.CSS_SELECTOR, '#register-form input[name="policy_version"]').click()
    browser.find_element(By.CSS_SELECTOR, '#register-form input[name="pd_consent_version"]').click()
    capture("регистрация-и-согласия")
    browser.find_element(By.CSS_SELECTOR, "#register-form button").click()
    WebDriverWait(browser, 20).until(lambda d: d.current_url.endswith("/dashboard"))
    assert "Тест" in wait_main(browser).text
    assert browser.find_element(By.CSS_SELECTOR, "#header nav a[href='/dashboard']").is_displayed()
    capture("личный-кабинет")


def test_enrollment_starts_lesson_and_dashboard_can_resume(browser: webdriver.Edge, capture) -> None:
    browser.get(browser.current_url.rstrip("/") + "/register")
    wait_main(browser)
    suffix = str(time.time_ns())
    browser.find_element(By.CSS_SELECTOR, '#register-form input[name="name"]').send_keys("Ученик Selenium")
    browser.find_element(By.CSS_SELECTOR, '#register-form input[name="email"]').send_keys(f"learner-{suffix}@example.test")
    browser.find_element(By.CSS_SELECTOR, '#register-form input[name="password"]').send_keys("Selenium-pass-123")
    browser.find_element(By.CSS_SELECTOR, '#register-form input[name="policy_version"]').click()
    browser.find_element(By.CSS_SELECTOR, '#register-form input[name="pd_consent_version"]').click()
    browser.find_element(By.CSS_SELECTOR, "#register-form button").click()
    WebDriverWait(browser, 20).until(lambda d: d.current_url.endswith("/dashboard"))

    browser.get(browser.current_url.rsplit("/", 1)[0] + "/courses")
    wait_main(browser)
    course_link = browser.find_element(By.CSS_SELECTOR, ".catalog-results .card h3 a")
    browser.execute_script("arguments[0].scrollIntoView({block:'center'}); arguments[0].click();", course_link)
    WebDriverWait(browser, 20).until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-action="enroll"]'))).click()
    WebDriverWait(browser, 20).until(lambda d: "/learn/" in d.current_url)
    assert browser.find_element(By.CSS_SELECTOR, ".lesson-content h1").is_displayed()
    text_before = browser.find_element(By.CSS_SELECTOR, '.lesson-reading p').value_of_css_property('font-size')
    browser.find_element(By.CSS_SELECTOR, '[data-setting="size"][data-value="large"]').click()
    text_after = browser.find_element(By.CSS_SELECTOR, '.lesson-reading p').value_of_css_property('font-size')
    assert text_before != text_after
    assert "22 px" in browser.find_element(By.CSS_SELECTOR, ".reader-status").text
    capture("настройки-чтения")
    capture("учебный-экран")

    browser.find_element(By.CSS_SELECTOR, "#header nav a[href='/dashboard']").click()
    WebDriverWait(browser, 20).until(lambda d: d.current_url.endswith("/dashboard"))
    assert browser.find_element(By.CSS_SELECTOR, ".continue").is_displayed()
    assert browser.find_element(By.CSS_SELECTOR, ".continue a.button").get_attribute("href").find("/learn/") >= 0
    capture("продолжение-обучения")
