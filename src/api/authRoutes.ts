import { Router, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { UserRepository } from "../database/repositories/userRepository";
import { hashPassword, comparePassword } from "../auth/password";
import { generateToken } from "../auth/jwt";

const router = Router();
const userRepo = new UserRepository();

// Register endpoint
router.post(
  "/register",
  body("username")
    .isLength({ min: 3, max: 20 })
    .matches(/^[a-zA-Z0-9_]+$/),
  body("email").isEmail(),
  body("password").isLength({ min: 8 }),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { username, email, password } = req.body;

    try {
      // Check if username or email already exists
      console.log(
        `Registration attempt for username: ${username}, email: ${email}`
      );

      const usernameTaken = userRepo.isUsernameTaken(username);
      const emailTaken = userRepo.isEmailTaken(email);

      console.log(`Username '${username}' taken: ${usernameTaken}`);
      console.log(`Email '${email}' taken: ${emailTaken}`);

      if (usernameTaken) {
        res.status(409).json({ error: "Username already taken" });
        return;
      }

      if (emailTaken) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }

      // Hash password and create user
      const passwordHash = await hashPassword(password);
      const user = userRepo.createUser({
        username,
        email,
        password_hash: passwordHash,
      });

      // Generate JWT token
      const token = generateToken({
        userId: user.id,
        username: user.username,
        display_name: user.display_name ?? user.username,
      });

      res.status(201).json({
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          display_name: user.display_name ?? user.username,
          created_at: user.created_at,
        },
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Login endpoint
router.post(
  "/login",
  body("username").notEmpty(),
  body("password").notEmpty(),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { username, password } = req.body;

    try {
      // Find user by username or email
      let user = userRepo.getUserByUsername(username);
      if (!user) {
        user = userRepo.getUserByEmail(username);
      }

      if (!user) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      // Verify password
      const isValid = await comparePassword(password, user.password_hash);
      if (!isValid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      // Update last login
      userRepo.updateLastLogin(user.id);

      // Generate JWT token
      const token = generateToken({
        userId: user.id,
        username: user.username,
        display_name: user.display_name ?? user.username,
      });

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          display_name: user.display_name ?? user.username,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Verify token endpoint
router.get("/verify", async (req: Request, res: Response) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ valid: false, error: "No token provided" });
    return;
  }

  try {
    const { verifyToken } = require("../auth/jwt");
    const user = verifyToken(token);

    if (!user) {
      res.status(403).json({ valid: false, error: "Invalid token" });
      return;
    }

    res.json({
      valid: true,
      user: {
        id: user.userId,
        username: user.username,
        display_name: user.display_name ?? user.username,
      },
    });
  } catch (error) {
    res.status(500).json({ valid: false, error: "Internal server error" });
  }
});

export default router;
