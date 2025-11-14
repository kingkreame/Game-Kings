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