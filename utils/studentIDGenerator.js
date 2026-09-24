const GenerateStudentId = ()=> {
    const year = new Date().getFullYear(); // Get the current year (2024)
    const randomLetters = Array.from({ length: 3 }, () =>
      String.fromCharCode(65 + Math.floor(Math.random() * 26))
    ).join(''); // Generate 3 random uppercase letters (AAA)
  
    const randomDigits = Math.floor(100 + Math.random() * 900); // Generate a random 3-digit number (123)
  
    return `STUD${year}_${randomLetters}${randomDigits}`;
  }
  module.exports = GenerateStudentId;