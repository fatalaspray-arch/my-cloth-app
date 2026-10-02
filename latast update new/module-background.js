(function () {
  const canvas = document.getElementById("moduleBgCanvas");
  if (!canvas) return;

  const context = canvas.getContext("2d");
  let particles = [];

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function initializeParticles() {
    particles = [];
    const count = Math.floor((canvas.width * canvas.height) / 9000);
    for (let index = 0; index < count; index += 1) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2 + 1,
        speedX: Math.random() * 0.5 - 0.25,
        speedY: Math.random() * 0.5 - 0.25
      });
    }
  }

  function animate() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const dotColor = isLight ? "rgba(15, 23, 42, 0.3)" : "rgba(255, 255, 255, 0.4)";
    const lineColor = isLight ? "79, 70, 229" : "129, 140, 248";

    particles.forEach((particle) => {
      particle.x += particle.speedX;
      particle.y += particle.speedY;
      if (particle.x > canvas.width || particle.x < 0) particle.speedX *= -1;
      if (particle.y > canvas.height || particle.y < 0) particle.speedY *= -1;

      context.fillStyle = dotColor;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.fill();
    });

    for (let first = 0; first < particles.length; first += 1) {
      for (let second = first + 1; second < particles.length; second += 1) {
        const horizontal = particles[first].x - particles[second].x;
        const vertical = particles[first].y - particles[second].y;
        const distance = Math.sqrt(horizontal * horizontal + vertical * vertical);
        if (distance < 120) {
          context.beginPath();
          context.strokeStyle = `rgba(${lineColor}, ${0.15 - distance / 1000})`;
          context.lineWidth = 1;
          context.moveTo(particles[first].x, particles[first].y);
          context.lineTo(particles[second].x, particles[second].y);
          context.stroke();
        }
      }
    }

    window.requestAnimationFrame(animate);
  }

  resizeCanvas();
  initializeParticles();
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("resize", initializeParticles);
  animate();
})();
