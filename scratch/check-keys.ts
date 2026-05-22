import { createClient } from '@vercel/kv';

async function run() {
  const url = "https://striking-panther-39520.upstash.io";
  const token = "AYN1AAIjcDFmZGI3ZGZiMzRjNjhkNDQ0NWI5ZGM5NjlhMTliNzljMHAxMA";

  const kv = createClient({ url, token });

  console.log("=== Fetching all keys in KV ===");
  try {
    const keys = await kv.keys('*');
    console.log("Keys found:", keys);

    for (const key of keys) {
      const val = await kv.get(key);
      console.log(`Key: ${key}`);
      console.log(`Value:`, val);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
