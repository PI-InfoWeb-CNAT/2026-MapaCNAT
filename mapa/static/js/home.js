
document.addEventListener("DOMContentLoaded", () => {

    /* =================================
       BACKGROUND RESPONSIVO
    ================================= */

    const page = document.querySelector(".home-page");
    const background = page?.dataset.background;

    function setHomeBackground() {

        if (!background) {
            console.error("Imagem de fundo não encontrada. Verifique o data-background.");
            return;
        }

        if (window.innerWidth <= 768) {
            document.body.style.backgroundImage = `
                linear-gradient(
                    to bottom,
                    rgba(255, 255, 255, 1) 0,
                    rgba(255, 255, 255, .9) 70px,
                    rgba(255, 255, 255, 0) 600px
                ),
                url("${background}")
            `;
        } else {
            document.body.style.backgroundImage = `
                radial-gradient(
                    circle at 150px 250px,
                    rgba(255, 255, 255, 1) 0,
                    rgba(255, 255, 255, .95) 300px,
                    rgba(255, 255, 255, 0) 600px
                ),
                url("${background}")
            `;
        }
    }

    setHomeBackground();

    window.addEventListener("resize", setHomeBackground);


    /* =================================
       INTRODUÇÃO DA PÁGINA
    ================================= */

    const elements = document.querySelectorAll(".intro-item");

    // Ativa o estado inicial da animação
    document.documentElement.classList.add("intro-ready");

    // Aguarda o navegador preparar o estado inicial
    requestAnimationFrame(() => {

        elements.forEach((element, index) => {

            // Intervalo entre cada elemento
            element.style.animationDelay = `${index * 160}ms`;

            // Ativa a animação
            element.classList.add("show");

        });

    });

});
