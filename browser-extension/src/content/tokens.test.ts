import { beforeEach, describe, expect, it } from "vitest";
import { CATEGORIES } from "../shared/categories.ts";
import { TokenVault } from "./tokens.ts";

let vault: TokenVault;
beforeEach(() => {
  vault = new TokenVault();
});

describe("토큰 만들기", () => {
  it("범주 이름과 번호로 [전화_1] 모양을 만든다", () => {
    expect(vault.tokenFor("phone_number", "010-1234-5678")).toBe("[전화_1]");
    expect(vault.tokenFor("email", "a@b.co")).toBe("[메일_1]");
    expect(vault.tokenFor("government_id", "900101-1234567")).toBe("[주민_1]");
  });

  it("같은 값은 항상 같은 토큰이다", () => {
    const first = vault.tokenFor("phone_number", "010-1234-5678");
    expect(vault.tokenFor("phone_number", "010-1234-5678")).toBe(first);
    expect(vault.size).toBe(1);
  });

  it("표기만 다른 같은 값도 같은 토큰이다 (하이픈·공백·대소문자·전각)", () => {
    const phone = vault.tokenFor("phone_number", "010-1234-5678");
    expect(vault.tokenFor("phone_number", "01012345678")).toBe(phone);
    expect(vault.tokenFor("phone_number", "010 1234 5678")).toBe(phone);
    expect(vault.tokenFor("phone_number", "０１０-１２３４-５６７８")).toBe(phone);
    const mail = vault.tokenFor("email", "Kim@Example.com");
    expect(vault.tokenFor("email", "kim@example.com")).toBe(mail);
  });

  it("다른 값은 번호가 늘어나고, 범주마다 따로 센다", () => {
    expect(vault.tokenFor("phone_number", "010-0000-0001")).toBe("[전화_1]");
    expect(vault.tokenFor("phone_number", "010-0000-0002")).toBe("[전화_2]");
    expect(vault.tokenFor("email", "a@b.co")).toBe("[메일_1]");
    expect(vault.tokenFor("phone_number", "010-0000-0003")).toBe("[전화_3]");
  });

  it("같은 숫자라도 범주가 다르면 다른 토큰이다", () => {
    expect(vault.tokenFor("phone_number", "0212345678")).toBe("[전화_1]");
    expect(vault.tokenFor("bank_account", "0212345678")).toBe("[계좌_1]");
  });

  it("모든 범주의 토큰 이름은 서로 다르고 토큰 문법을 깨지 않는다", () => {
    const labels = CATEGORIES.map((category) => category.tokenLabel);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).toMatch(/^[^\s_\[\]\d]+$/u);
  });
});

describe("토큰 되돌리기", () => {
  beforeEach(() => {
    vault.tokenFor("phone_number", "010-1234-5678"); // 전화_1
    vault.tokenFor("email", "kim@example.com"); // 메일_1
    vault.tokenFor("phone_number", "02-123-4567"); // 전화_2
  });

  it("텍스트 안의 토큰을 원래 값으로 바꾼다", () => {
    expect(vault.restoreText("[전화_1]로 연락하고 [메일_1]로 보내세요")).toBe(
      "010-1234-5678로 연락하고 kim@example.com로 보내세요",
    );
    expect(vault.restoreText("[전화_2]")).toBe("02-123-4567");
  });

  it("모델이 토큰을 조금 바꿔 써도 되돌린다", () => {
    expect(vault.restoreText("[전화_1]님")).toBe("010-1234-5678님");
    expect(vault.restoreText("전화_1 로 연락")).toBe("010-1234-5678 로 연락");
    expect(vault.restoreText("전화_1님")).toBe("010-1234-5678님");
    expect(vault.restoreText("[ 전화_1 ]")).toBe("010-1234-5678");
    expect(vault.restoreText("[전화 _ 1]")).toBe("010-1234-5678");
    expect(vault.restoreText("【전화_1】")).toBe("010-1234-5678");
    expect(vault.restoreText("［전화＿1］")).toBe("010-1234-5678");
  });

  it("이 탭에서 만들지 않은 토큰은 건드리지 않는다", () => {
    expect(vault.restoreText("[전화_9] [이름_1] [메일_2]")).toBe("[전화_9] [이름_1] [메일_2]");
  });

  it("번호가 더 긴 다른 토큰을 잘못 되돌리지 않는다", () => {
    // 전화_1 은 있지만 전화_10 은 없다: [전화_10] 의 앞부분만 잘라 바꾸면 안 된다.
    expect(vault.restoreText("[전화_10]")).toBe("[전화_10]");
    expect(vault.restoreText("전화_10")).toBe("전화_10");
    expect(vault.restoreText("전화_1_2")).toBe("전화_1_2");
  });

  it("괄호 없는 토큰은 다른 단어의 일부일 때 건드리지 않는다", () => {
    expect(vault.restoreText("휴대전화_1 번호")).toBe("휴대전화_1 번호");
    expect(vault.restoreText("abc전화_1")).toBe("abc전화_1");
  });

  describe("스트리밍 안전: 끝이 확정되기 전에는 되돌리지 않는다", () => {
    it("닫는 괄호가 오기 전의 [전화_1 은 그대로 둔다 (먼저 바꾸면 [010-… 처럼 괄호가 남는다)", () => {
      expect(vault.restoreText("답변 [전화_1")).toBe("답변 [전화_1");
      expect(vault.restoreText("답변 [전화_1 ")).toBe("답변 [전화_1 ");
      expect(vault.restoreText("답변 [전화_1]")).toBe("답변 010-1234-5678");
    });

    it("글 맨 끝의 괄호 없는 토큰은 기다린다 (전화_1 뒤에 0이 오면 전화_10이다)", () => {
      expect(vault.restoreText("답변 전화_1")).toBe("답변 전화_1");
      expect(vault.restoreText("답변 전화_10")).toBe("답변 전화_10");
      expect(vault.restoreText("답변 전화_1 ")).toBe("답변 010-1234-5678 ");
    });

    it("글자가 한 글자씩 도착하는 모든 중간 상태에서, 잘못 바꾸지 않고 마지막에 한 번만 바꾼다", () => {
      const final = "연락: [전화_1]님";
      let streamed = "";
      let current = "";
      for (const char of final) {
        streamed += char;
        // 사이트는 매번 전체 글자를 다시 쓰고, 복원기는 그 위에서 동작한다고 가정한다.
        current = vault.restoreText(streamed);
        // 중간에 토큰이 깨진 채 값만 끼어드는 일이 없어야 한다.
        expect(current).not.toMatch(/\[010|010-1234-5678\]/);
      }
      expect(current).toBe("연락: 010-1234-5678님");
    });
  });

  it("대응표가 비어 있으면 아무것도 바꾸지 않는다", () => {
    const empty = new TokenVault();
    expect(empty.restoreText("[전화_1]")).toBe("[전화_1]");
  });

  it("clear()는 대응표를 비운다", () => {
    vault.clear();
    expect(vault.size).toBe(0);
    expect(vault.restoreText("[전화_1]")).toBe("[전화_1]");
    // 번호도 처음부터 다시 센다.
    expect(vault.tokenFor("phone_number", "010-9999-9999")).toBe("[전화_1]");
  });

  it("원래 값은 처음 입력된 표기 그대로 돌려준다", () => {
    const v = new TokenVault();
    v.tokenFor("phone_number", "010 1234 5678");
    v.tokenFor("phone_number", "01012345678"); // 같은 값, 두 번째 표기
    expect(v.restoreText("[전화_1]")).toBe("010 1234 5678");
  });
});
