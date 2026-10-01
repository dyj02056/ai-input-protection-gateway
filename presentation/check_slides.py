"""발표자료 규칙 검사: 슬라이드의 모든 텍스트가 10자 이하인지, 문장형 어미가 없는지, 글자 크기가 18px 이상인지.

  py presentation/check_slides.py

- 검사 대상: <section class="slide"> 안의 눈에 보이는 텍스트 노드 하나하나(공백 포함 길이).
- 제외: 발표자 노트(<aside class="notes">, 화면 밖 패널에만 나옴), <style>·<script>, 아이콘 클래스 이름.
"""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

HTML = Path(__file__).resolve().parent / "index.html"
MAX_CHARS = 10
SENTENCE_ENDINGS = ("합니다", "입니다", "습니다", "있다", "한다", "됩니다", "하세요", "해요")
MIN_FONT_PX = 18
# 글자가 아닌 장식(창 위쪽 점 아이콘)은 작아도 됩니다.
FONT_ALLOWED_SELECTORS = (".win .bar i",)
# 요청된 필수 문구는 어미 검사에서 제외합니다.
SENTENCE_ALLOWED = ("감사합니다",)


class Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.slide = 0
        self.depth_slide = 0
        self.skip: list[str] = []  # 건너뛰는 요소 스택(notes/style/script)
        self.texts: list[tuple[int, str]] = []
        self.stack: list[tuple[str, bool]] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        attributes = dict(attrs)
        classes = (attributes.get("class") or "").split()
        skipping = tag in ("style", "script", "title") or (tag == "aside" and "notes" in classes)
        if tag == "section" and "slide" in classes:
            self.slide += 1
            self.depth_slide = len(self.stack) + 1
        self.stack.append((tag, skipping))
        if skipping:
            self.skip.append(tag)

    def handle_endtag(self, tag: str) -> None:
        while self.stack:
            name, skipping = self.stack.pop()
            if skipping and self.skip:
                self.skip.pop()
            if name == tag:
                break
        if tag == "section":
            pass

    def handle_data(self, data: str) -> None:
        if self.skip or self.slide == 0:
            return
        # 슬라이드 바깥(진행 표시 등)은 제외
        if not any(name == "section" for name, _ in self.stack):
            return
        text = data.strip()
        if text:
            self.texts.append((self.slide, text))


def main() -> int:
    source = HTML.read_text(encoding="utf-8")
    collector = Collector()
    collector.feed(source)

    problems: list[str] = []
    longest = 0
    for slide, text in collector.texts:
        length = len(text)
        longest = max(longest, length)
        if length > MAX_CHARS:
            problems.append(f"[슬라이드 {slide}] {length}자 초과: {text!r}")
        if text not in SENTENCE_ALLOWED and any(ending in text for ending in SENTENCE_ENDINGS):
            problems.append(f"[슬라이드 {slide}] 문장형 어미: {text!r}")

    # 글자 크기: 선언된 font-size 중 18px 미만을 찾습니다(선택자 단위).
    style = "".join(re.findall(r"<style>(.*?)</style>", source, flags=re.S))
    for selector, body in re.findall(r"([^{}@]+)\{([^{}]*)\}", style):
        match = re.search(r"font-size:\s*(\d+(?:\.\d+)?)px", body)
        if match and float(match.group(1)) < MIN_FONT_PX:
            name = " ".join(selector.split())
            if name not in FONT_ALLOWED_SELECTORS:
                problems.append(f"글자 크기 {match.group(1)}px < {MIN_FONT_PX}px: {name}")
    for match in re.finditer(r'style="[^"]*font-size:\s*(\d+(?:\.\d+)?)px', source):
        if float(match.group(1)) < MIN_FONT_PX:
            # 아이콘 크기 지정이 대부분이라 텍스트와 함께 쓰인 경우만 확인하도록 위치를 알려 줍니다.
            line = source.count("\n", 0, match.start()) + 1
            problems.append(f"인라인 글자 크기 {match.group(1)}px (줄 {line}) — 아이콘이 아니면 키우세요")

    slides = collector.slide
    print(f"슬라이드 {slides}장 · 텍스트 요소 {len(collector.texts)}개 · 가장 긴 것 {longest}자")
    if problems:
        print("\n".join(problems))
        return 1
    print("통과: 모든 텍스트 10자 이하, 문장형 없음, 글자 크기 18px 이상")
    return 0


if __name__ == "__main__":
    sys.exit(main())
