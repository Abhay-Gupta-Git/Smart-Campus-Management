const FIRST_NAMES = [
  "Aarav", "Aarohi", "Aditi", "Aditya", "Advait", "Aishwarya", "Akash", "Akshara", "Amara", "Ameya",
  "Amrita", "Ananya", "Aniket", "Anirudh", "Anjali", "Anoushka", "Arjun", "Arnav", "Ayesha", "Bhavna",
  "Chaitanya", "Charu", "Chirag", "Darshan", "Deepa", "Devika", "Dhruv", "Diya", "Esha", "Farhan",
  "Gauri", "Gautam", "Harini", "Harsh", "Ibrahim", "Ira", "Ishaan", "Ishita", "Jaya", "Kabir",
  "Kalyani", "Karan", "Kavya", "Kiara", "Kiran", "Krishna", "Lakshmi", "Madhav", "Mahima", "Maitreyi",
  "Manav", "Meera", "Mihir", "Mira", "Mohit", "Nandini", "Nikhil", "Nisha", "Ojas", "Omkar",
  "Pari", "Pooja", "Pranav", "Prisha", "Rahul", "Rhea", "Rohan", "Roshni", "Saanvi", "Sahil",
  "Sakshi", "Sameer", "Sana", "Sanjana", "Shaurya", "Shreya", "Siddharth", "Simran", "Tanmay", "Tanvi",
  "Tara", "Trisha", "Uday", "Uma", "Vedant", "Vidya", "Vihaan", "Vikram", "Yash", "Zara",
  "Abhinav", "Akhila", "Anand", "Anushree", "Arpita", "Avinash", "Bharat", "Bhumika", "Dhanush", "Ekta",
  "Faisal", "Geetanjali", "Girish", "Hema", "Jayant", "Jyoti", "Kaushik", "Leela", "Mansi", "Navin",
  "Neha", "Nirav", "Pallavi", "Pratik", "Rekha", "Ritu", "Srinivas", "Swara", "Tushar", "Vasudha",
];

const SURNAMES = [
  "Acharya", "Agarwal", "Ahluwalia", "Ahuja", "Bajaj", "Banerjee", "Bansal", "Basu", "Bedi", "Bhat",
  "Bhatia", "Bhattacharya", "Bose", "Chakraborty", "Chandra", "Chatterjee", "Chauhan", "Chawla", "Das", "Datta",
  "Desai", "Deshmukh", "Dhawan", "Dixit", "Dubey", "Dutta", "Gandhi", "Ghosh", "Gill", "Gokhale",
  "Goswami", "Gupta", "Iyer", "Jain", "Jha", "Joshi", "Kadam", "Kapoor", "Kar", "Kaur",
  "Khanna", "Khan", "Kohli", "Kulkarni", "Kumar", "Lal", "Mahajan", "Malhotra", "Mehta", "Menon",
  "Mishra", "Mukherjee", "Nair", "Naidu", "Nanda", "Nayak", "Panda", "Pandey", "Parikh", "Patel",
  "Pillai", "Prasad", "Rao", "Rathore", "Reddy", "Roy", "Saha", "Saxena", "Sen", "Shah",
  "Sharma", "Shetty", "Shukla", "Sinha", "Singh", "Sodhi", "Srinivasan", "Subramanian", "Talwar", "Thakur",
  "Trivedi", "Vaidya", "Varma", "Verma", "Wadhwa", "Yadav", "Zutshi", "Bora", "Chopra", "Dey",
  "Fernandes", "George", "Lobo", "Menezes", "Mirza", "Qureshi", "Pathak", "Rana", "Sengupta", "Tandon",
  "Bhardwaj", "Bhonsle", "Choudhary", "Dhar", "Ganguly", "Hegde", "Kashyap", "Khatri", "Lahiri", "Mandal",
  "Mathew", "Mohan", "Narayan", "Purohit", "Ranganathan", "Sarkar", "Thampi", "Upadhyay", "Venkatesh", "Wagle",
];

const MIDDLE_NAMES = [
  "Anand", "Chandra", "Dev", "Kiran", "Kumar", "Mohan", "Narayan", "Prakash", "Raj", "Ravi",
  "Shankar", "Vijay", "Asha", "Devi", "Lakshmi", "Priya", "Rani", "Sai", "Sree", "Vani",
  "Arun", "Bala", "Harish", "Nath", "Om", "Raghav", "Sanjay", "Surya", "Venkata", "Vishal",
];

const NAME_SPACE = FIRST_NAMES.length * SURNAMES.length;
const NAME_MULTIPLIER = 7919;

function demoPersonName(index, group = "student") {
  if (!Number.isInteger(index) || index < 0) throw new RangeError("Demo name index must be a non-negative integer.");
  const groupOffset = group === "faculty" ? 2711 : group === "technician" ? 5939 : 0;
  const shuffled = (index * NAME_MULTIPLIER + groupOffset) % NAME_SPACE;
  const first = FIRST_NAMES[Math.floor(shuffled / SURNAMES.length)];
  const surname = SURNAMES[shuffled % SURNAMES.length];
  const middle = MIDDLE_NAMES[(shuffled * 17 + index * 13 + groupOffset) % MIDDLE_NAMES.length];
  const useMiddle = (shuffled + index * 7 + groupOffset) % 3 !== 0;
  return `${first}${useMiddle ? ` ${middle}` : ""} ${surname}`;
}

function validateDemoNameUniqueness() {
  const counts = { student: 6000, faculty: 450, technician: 36 };
  return Object.fromEntries(Object.entries(counts).map(([group, count]) => {
    const names = Array.from({ length: count }, (_, index) => demoPersonName(index, group));
    if (new Set(names).size !== count) throw new Error(`Demo ${group} names are not unique.`);
    return [group, { total: count, unique: new Set(names).size }];
  }));
}

module.exports = { demoPersonName, validateDemoNameUniqueness };
