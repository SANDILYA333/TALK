# 💬 TALK

A modern, full-stack real-time chat application built with the MERN ecosystem and Socket.io. It provides instant messaging, secure authentication, image sharing, and a clean responsive interface for seamless communication.

## 🌐 Live Demo

https://real-time-chat-application-hc8y.onrender.com

---

# ✨ Features

- 🔐 Secure Authentication with Clerk
- 💬 Real-time messaging using Socket.io
- 🟢 Live online/offline user status
- 🖼️ Image sharing with ImageKit
- ⚡ Instant message delivery
- 📱 Fully responsive UI
- 🎨 Modern interface built with Hero UI & Tailwind CSS
- 🚀 Fast global deployment on Render
- 📦 Persistent chat storage using MongoDB Atlas
- ⚙️ Global state management using Zustand

---

# 🛠️ Tech Stack

## Frontend

- React
- Tailwind CSS
- Hero UI
- Zustand
- Socket.io Client

## Backend

- Node.js
- Express.js
- MongoDB
- Socket.io
- Clerk Authentication
- ImageKit

## Deployment

- Frontend — Render
- Backend — Render
- Database — MongoDB Atlas

---

# 📸 Screenshots

> Add screenshots here

```
/screenshots
    home.png
    login.png
    chat.png
```

Example:

```md
![Home](screenshots/home.png)
![Chat](screenshots/chat.png)
```

---

# 🚀 Getting Started

## Clone the repository

```bash
git clone https://github.com/your-username/Real-Time-Chat-Application.git

cd Real-Time-Chat-Application
```

---

## Install Dependencies

### Frontend

```bash
cd client
npm install
```

### Backend

```bash
cd server
npm install
```

---

## Environment Variables

Create a `.env` file inside the backend directory.

```env
PORT=5000

MONGODB_URI=your_mongodb_connection_string

CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key

IMAGEKIT_PUBLIC_KEY=your_imagekit_public_key
IMAGEKIT_PRIVATE_KEY=your_imagekit_private_key
IMAGEKIT_URL_ENDPOINT=your_imagekit_url_endpoint
```

Create another `.env` file inside the frontend.

```env
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
VITE_API_URL=http://localhost:5000
```

---

# ▶️ Run Locally

### Backend

```bash
npm run dev
```

### Frontend

```bash
npm run dev
```

---

# 📂 Project Structure

```
Real-Time-Chat-Application
│
├── client
│   ├── src
│   ├── public
│   └── package.json
│
├── server
│   ├── controllers
│   ├── routes
│   ├── middleware
│   ├── models
│   ├── socket
│   └── package.json
│
└── README.md
```

---

# 🔒 Authentication

User authentication is handled using **Clerk**, providing:

- Secure Sign In
- Secure Sign Up
- Session Management
- Protected Routes

---

# ⚡ Real-Time Communication

Real-time communication is powered by **Socket.io**, enabling:

- Instant messaging
- Live online users
- Real-time updates
- Bidirectional communication

---

# ☁️ Image Uploads

Image uploads are handled using **ImageKit**, providing:

- Fast CDN delivery
- Secure uploads
- Optimized image storage

---

# 🚀 Deployment

The application is deployed using:

- **Frontend:** Render
- **Backend:** Render
- **Database:** MongoDB Atlas

Live Website:

https://real-time-chat-application-hc8y.onrender.com

---

# 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create your feature branch

```bash
git checkout -b feature-name
```

3. Commit your changes

```bash
git commit -m "Add feature"
```

4. Push the branch

```bash
git push origin feature-name
```

5. Open a Pull Request

---

# 📄 License

This project is licensed under the MIT License.

---

# 👨‍💻 Author

**Sandilya**

GitHub: https://github.com/SANDILYA333

---

⭐ If you found this project useful, consider giving it a star!
