import axios from 'axios';

//export const config = { schedule: '*/30 * * * *' };

export default async (_req, _res) => {
  const response = await axios.post('https://tknz.fun/.netlify/functions/update-leaderboard-background', {
    headers: {
      'Authorization': `Bearer ${process.env.WEBHOOK_SECRET}`,
    },
  });
  console.log(response);
};
