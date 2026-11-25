# Game-Kings
Game space and fun lab
<!DOCTYPE html><html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Simple Quiz Game</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f2f2f2;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
    }
    .container {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
      width: 300px;
      text-align: center;
    }
    button {
      width: 100%;
      padding: 10px;
      margin-top: 10px;
      border: none;
      border-radius: 5px;
      background: #4CAF50;
      color: white;
      cursor: pointer;
      font-size: 16px;
    }
    button:hover { background: #45a049; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Quiz Game</h2>
    <p id="question">Loading...</p>
    <div id="answers"></div>
    <p id="result"></p>
  </div>  <script>
    const quiz = [
      { q: "What is the capital of France?", a: ["Paris", "London", "Rome"], correct: 0 },
      { q: "2 + 2 = ?", a: ["3", "4", "5"], correct: 1 },
      { q: "Which planet is known as the Red Planet?", a: ["Earth", "Mars", "Jupiter"], correct: 1 }
    ];

    let current = 0;

    function loadQuestion() {
      const question = quiz[current];
      document.getElementById("question").innerText = question.q;
      const answersDiv = document.getElementById("answers");
      answersDiv.innerHTML = "";

      question.a.forEach((answer, index) => {
        const btn = document.createElement("button");
        btn.textContent = answer;
        btn.onclick = () => checkAnswer(index);
        answersDiv.appendChild(btn);
      });
    }

    function checkAnswer(index) {
      const result = document.getElementById("result");
      if (index === quiz[current].correct) {
        result.textContent = "Correct!";
        result.style.color = "green";
      } else {
        result.textContent = "Wrong!";
        result.style.color = "red";
      }

      current++;
      if (current < quiz.length) {
        setTimeout(() => {
          result.textContent = "";
          loadQuestion();
        }, 1000);
      } else {
        setTimeout(() => {
          document.querySelector(".container").innerHTML = "<h2>Game Over!</h2><p>You completed the quiz.</p>";
        }, 1000);
      }
    }

    loadQuestion();
  </script></body>
</html>

## Chess

Game Kings Chess is in `chess/`. Free play is pass-and-play or Easy self-play, on the marble and walnut board. Medium, Hard, and Expert — plus extra color washes, piece grades, and capture effects — are one premium game at a time ($4.99, or `PRICE_LABEL`). A win grants one free replay. Training lessons and Medium/Hard/Expert self-play open while a premium credit is on the account; the credit is spent only when a premium game starts. The jeweled board is earned on the device after 3 wins against the computer or after all 3 lessons. Rewards are badges, titles, and that board. There are no cash prizes.

The paid gate stays off unless `PASS_GATE_ENABLED=true`. Copy `chess/.env.example` to `chess/.env` and fill the blanks locally; do not commit secrets.

```bash
cd chess
npm ci
npm test
npm run build
npm start
```

Move rules use [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause). Painted sets are generated with `python3 scripts/prepare-art.py`.
