# Hangout — call de voz, câmera e tela pra você e seus amigos

Mini "Discord" com:
- 🎙️ Voz
- 📷 Câmera
- 🖥️ Compartilhamento de tela (ao mesmo tempo que a câmera)
- 💬 Chat de texto
- Sem login, sem banco de dados — entra com um nome e um código de sala

Funciona bem pra grupos pequenos (2 a ~6 pessoas ao mesmo tempo). Não precisa instalar nada — só rodar o servidor uma vez e mandar o link pros amigos.

## 1. Rodar no seu computador (teste rápido)

Precisa ter o [Node.js](https://nodejs.org) instalado (versão 18 ou mais nova).

```bash
npm install
npm start
```

Abre `http://localhost:3000` no navegador. Só funciona pra você mesmo testar sozinho nessa etapa — pros amigos entrarem de verdade, precisa hospedar online (passo 2).

## 2. Colocar online de graça (pra seus amigos entrarem)

Recomendo o **Render.com**, porque o plano grátis dele mantém WebSocket funcionando (necessário pra chamada em tempo real).

1. Cria uma conta em https://render.com (dá pra usar GitHub pra logar).
2. Sobe esses arquivos num repositório do GitHub (cria um repo novo e faz upload da pasta inteira).
3. No painel do Render, clica em **New +** → **Web Service**.
4. Conecta o repositório que você acabou de criar.
5. Configura:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
6. Clica em **Create Web Service** e espera o deploy terminar (uns 2-3 minutos).
7. Você vai receber uma URL tipo `https://seu-app.onrender.com` — é esse link que você manda pros amigos.

> No plano grátis do Render, o servidor "dorme" depois de um tempo sem uso e demora uns 30-50 segundos pra acordar na primeira visita do dia. Isso é normal do plano free, não é bug.

Alternativas equivalentes: **Railway.app** e **Fly.io** (o processo é parecido: conectar repositório, `npm install`, `npm start`).

## 3. Como usar

1. Todo mundo abre a URL do app.
2. Cada um digita um nome e o **mesmo código de sala** (ex: `galera-do-valorant`).
3. Pronto — todo mundo se vê e se ouve. Qualquer um pode ligar o compartilhamento de tela a qualquer momento, junto com a câmera.
4. Botão "Copiar link do convite" já manda o link com o código da sala preenchido, pra galera só clicar e entrar.

## Limitações (bom saber)

- É uma malha **peer-to-peer** (cada pessoa se conecta direto com as outras). Funciona liso até uns 4-6 participantes; passando disso, fica pesado pra quem tem internet/PC mais fraco, porque cada pessoa envia vídeo pra todo mundo ao mesmo tempo.
- Não tem gravação, não tem servidores separados/canais (é uma sala só por código) e não tem contas de usuário — é propositalmente simples.
- Em redes mais restritas (algumas redes corporativas/universitárias), a conexão direta pode falhar por causa de firewall. Pra resolver isso de vez, seria necessário um servidor TURN (não incluído aqui, mas dá pra adicionar um serviço como o Metered.ca ou Twilio TURN depois, se precisar).

## Estrutura do projeto

```
discord-clone/
├── server.js          # servidor Node (Express + Socket.io) — só faz a "apresentação" entre os participantes
├── package.json
└── public/
    ├── index.html      # tela de entrada + tela da chamada
    ├── style.css        # visual
    └── client.js        # toda a lógica de câmera/tela/voz/chat (WebRTC)
```

Quer que eu adicione algo depois (mais participantes, servidor TURN pra conexões mais estáveis, várias "salas/canais" dentro do mesmo app, gravação, etc)? É só pedir.
