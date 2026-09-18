exports.handler = async (event) => {
  try {
    const symbol = event.queryStringParameters?.symbol?.toUpperCase();

    if (!symbol) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "اكتب رمز السهم" })
      };
    }

    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "مفتاح Alpha Vantage غير موجود في Netlify" })
      };
    }

    const url =
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED` +
      `&symbol=${encodeURIComponent(symbol)}` +
      `&outputsize=full&apikey=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data["Error Message"]) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "رمز السهم غير صحيح أو غير موجود" })
      };
    }

    if (data["Note"]) {
      return {
        statusCode: 429,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "تم تجاوز حد طلبات Alpha Vantage مؤقتًا"
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        symbol,
        data
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: "حدث خطأ في الاتصال",
        details: error.message
      })
    };
  }
};
